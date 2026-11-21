import type { LatLon, OsmWay } from "../domain/types.js";
import { distanceM } from "./distance.js";

type Edge = { to: string; lengthM: number; wayName: string | null; highway: string | null };

/** Roads a rider arrives on before turning towards a home. */
export const MAIN_ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);

export type ApproachStep = { location: LatLon; street: string | null };

/**
 * Small in-process road graph (P5) built from the OSM ways within ~500 m of one
 * home. Small enough that plain Dijkstra over an array is fast.
 */
export class RoadGraph {
  private readonly nodes = new Map<string, LatLon>();
  private readonly edges = new Map<string, Edge[]>();

  constructor(ways: OsmWay[]) {
    for (const way of ways) {
      for (let i = 0; i < way.nodes.length; i++) {
        const node = way.nodes[i]!;
        this.nodes.set(node.id, node.location);
        const prev = way.nodes[i - 1];
        if (prev) {
          const lengthM = distanceM(prev.location, node.location);
          this.addEdge(prev.id, { to: node.id, lengthM, wayName: way.name, highway: way.highway });
          this.addEdge(node.id, { to: prev.id, lengthM, wayName: way.name, highway: way.highway });
        }
      }
    }
  }

  private addEdge(from: string, edge: Edge) {
    const list = this.edges.get(from);
    if (list) list.push(edge);
    else this.edges.set(from, [edge]);
  }

  get size(): number {
    return this.nodes.size;
  }

  nearestNode(point: LatLon): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, loc] of this.nodes) {
      const d = distanceM(point, loc);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Shortest path as the list of edges walked, or null if unreachable. */
  shortestPath(fromId: string, toId: string): Edge[] | null {
    if (fromId === toId) return [];
    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, { node: string; edge: Edge }>();
    const done = new Set<string>();
    while (true) {
      let current: string | null = null;
      let currentD = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < currentD) {
          current = id;
          currentD = d;
        }
      }
      if (current === null) return null;
      if (current === toId) break;
      done.add(current);
      for (const edge of this.edges.get(current) ?? []) {
        const nd = currentD + edge.lengthM;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, { node: current, edge });
        }
      }
    }
    const path: Edge[] = [];
    let at = toId;
    while (at !== fromId) {
      const step = prev.get(at)!;
      path.unshift(step.edge);
      at = step.node;
    }
    return path;
  }

  /**
   * The road line between two points, following the shortest path through the
   * graph and starting/ending at the nearest road nodes. `reachable: false`
   * when the graph is empty or the two points aren't connected.
   */
  roadLine(from: LatLon, to: LatLon): { reachable: true; line: LatLon[] } | { reachable: false } {
    const a = this.nearestNode(from);
    const b = this.nearestNode(to);
    if (a === null || b === null) return { reachable: false };
    const path = this.shortestPath(a, b);
    if (path === null) return { reachable: false };
    return { reachable: true, line: [this.nodes.get(a)!, ...path.map((e) => this.nodes.get(e.to)!)] };
  }

  /**
   * How a rider reaches `door`: the shortest path from the nearest point on a
   * main road (by road distance) to the road node nearest the door, in rider
   * order. Each step carries the street of the stretch leading into it. Null if
   * no main road is reachable within `maxM`.
   */
  approach(door: LatLon, maxM = 2_000): { entryStreet: string | null; steps: ApproachStep[] } | null {
    const start = this.nearestNode(door);
    if (start === null) return null;
    const touchesMainRoad = (id: string) => (this.edges.get(id) ?? []).some((e) => e.highway !== null && MAIN_ROADS.has(e.highway));
    const dist = new Map<string, number>([[start, 0]]);
    const prev = new Map<string, { node: string; edge: Edge }>();
    const done = new Set<string>();
    let entry: string | null = null;
    while (true) {
      let current: string | null = null;
      let currentD = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < currentD) {
          current = id;
          currentD = d;
        }
      }
      if (current === null || currentD > maxM) break;
      if (touchesMainRoad(current)) {
        entry = current;
        break;
      }
      done.add(current);
      for (const edge of this.edges.get(current) ?? []) {
        const nd = currentD + edge.lengthM;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, { node: current, edge });
        }
      }
    }
    if (entry === null) return null;
    // Walk back from the entry to the door: that's the rider's order.
    const steps: ApproachStep[] = [{ location: this.nodes.get(entry)!, street: null }];
    let at = entry;
    while (at !== start) {
      const step = prev.get(at)!;
      steps.push({ location: this.nodes.get(step.node)!, street: step.edge.wayName });
      at = step.node;
    }
    const mainEdge = (this.edges.get(entry) ?? []).find((e) => e.highway !== null && MAIN_ROADS.has(e.highway) && e.wayName);
    return { entryStreet: mainEdge?.wayName ?? null, steps };
  }

  /**
   * Name of the first named street on the shortest path between two points.
   * Returns `{ reachable: false }` if no path exists, and `street: null` if the
   * path exists but none of its roads has a name in OSM.
   */
  firstStreet(from: LatLon, to: LatLon): { reachable: boolean; street: string | null } {
    const a = this.nearestNode(from);
    const b = this.nearestNode(to);
    if (a === null || b === null) return { reachable: false, street: null };
    const path = this.shortestPath(a, b);
    if (path === null) return { reachable: false, street: null };
    return { reachable: true, street: path.find((e) => e.wayName)?.wayName ?? null };
  }
}
