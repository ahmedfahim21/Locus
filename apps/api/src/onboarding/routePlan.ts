import type { LatLon } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import type { RoadGraph } from "../geo/roadGraph.js";

export type Turn = {
  /** Metres from the main-road entry along the route. */
  atM: number;
  location: LatLon;
  direction: "left" | "right";
  /** Street the rider turns onto, if named in OSM. */
  onto: string | null;
};

export type RoutePlan = {
  /** Main road the rider comes from, if named. */
  entryStreet: string | null;
  /** Entry → door, ending exactly at the door. */
  line: LatLon[];
  lengthM: number;
  turns: Turn[];
};

/** Bends gentler than this aren't worth a "left/right" instruction. */
const TURN_DEGREES = 35;
/** Bearings are measured over this many metres either side, so OSM jitter doesn't read as a turn. */
const WINDOW_M = 15;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Compass bearing a → b in degrees (0 = north, 90 = east). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cumulative distance at each vertex. */
export function cumulative(line: LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + distanceM(line[i - 1]!, line[i]!));
  return out;
}

/** The point `d` metres along the line (clamped to its ends). */
export function pointAt(line: LatLon[], cum: number[], d: number): LatLon {
  if (d <= 0) return line[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return line[line.length - 1]!;
  let i = 1;
  while (cum[i]! < d) i++;
  const a = line[i - 1]!;
  const b = line[i]!;
  const f = (d - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Where a point sits relative to the line: metres along it, and metres off it. */
export function project(line: LatLon[], cum: number[], p: LatLon): { alongM: number; offM: number } {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos(toRad(p.lat));
  let best = { alongM: 0, offM: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ax = (a.lon - p.lon) * mLon;
    const ay = (a.lat - p.lat) * mLat;
    const bx = (b.lon - p.lon) * mLon;
    const by = (b.lat - p.lat) * mLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.offM) best = { alongM: cum[i - 1]! + t * Math.sqrt(len2), offM: off };
  }
  return best;
}

/**
 * The route a rider takes from the nearest main road to the door, with its
 * turns. The rider's direction of travel is known here (towards the door), so
 * unlike off-route guidance, left and right are meaningful.
 */
export function planRoute(graph: RoadGraph, door: LatLon): RoutePlan | null {
  const approach = graph.approach(door);
  if (!approach) return null;
  const line = approach.steps.map((s) => s.location);
  const last = line[line.length - 1]!;
  if (distanceM(last, door) > 1) line.push(door);
  const cum = cumulative(line);
  const lengthM = cum[cum.length - 1]!;

  const turns: Turn[] = [];
  for (let i = 1; i < line.length - 1; i++) {
    const at = cum[i]!;
    if (at < WINDOW_M / 2 || lengthM - at < WINDOW_M / 2) continue;
    const before = pointAt(line, cum, at - WINDOW_M);
    const after = pointAt(line, cum, at + WINDOW_M);
    const diff = ((bearing(line[i]!, after) - bearing(before, line[i]!) + 540) % 360) - 180;
    if (Math.abs(diff) < TURN_DEGREES) continue;
    const previous = turns[turns.length - 1];
    if (previous && at - previous.atM < WINDOW_M * 1.5) continue;
    turns.push({
      atM: at,
      location: line[i]!,
      direction: diff > 0 ? "right" : "left",
      onto: approach.steps[i + 1]?.street ?? null,
    });
  }
  return { entryStreet: approach.entryStreet, line, lengthM, turns };
}
