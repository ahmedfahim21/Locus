import type { LatLon, TrackPoint } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";

/** A problem with the walk the recipient can fix by recording again. Shown to them as-is. */
export class WalkError extends Error {}

/** GPS fixes worse than this are dropped before sampling. */
export const MAX_ACCURACY_M = 50;
/** A walk shorter than this is almost certainly GPS that never moved. */
export const MIN_WALK_M = 25;
export const FRAME_SPACING_M = 10;
export const MAX_FRAMES = 24;

export type FrameSample = { atS: number; location: LatLon; distanceM: number };

/** Usable fixes in time order. */
export function cleanTrack(track: TrackPoint[]): TrackPoint[] {
  const usable = track.filter((p) => p.accuracyM <= MAX_ACCURACY_M).sort((a, b) => a.t - b.t);
  if (usable.length < 2) {
    throw new WalkError("Your phone didn't get a clear GPS fix during the walk. Record again outdoors, with location on.");
  }
  return usable;
}

/**
 * Picks frame times every ~10 m along the walk (P: walk video, section 4.6), so
 * standing still doesn't produce twenty frames of the same gate. Each sample
 * carries the GPS position the frame was taken at.
 */
export function sampleAlongTrack(track: TrackPoint[], videoDurationS: number): FrameSample[] {
  const pts = cleanTrack(track);
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1]! + distanceM(pts[i - 1]!, pts[i]!));
  const total = cumulative[cumulative.length - 1]!;
  if (total < MIN_WALK_M) {
    throw new WalkError(
      `The GPS track only moved ${Math.round(total)} m. Start at the main road and walk to your door while recording.`,
    );
  }

  const count = Math.min(MAX_FRAMES, Math.floor(total / FRAME_SPACING_M) + 1);
  const spacing = total / (count - 1);
  const lastS = Math.max(0, videoDurationS - 0.1);
  const samples: FrameSample[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = Math.min(total, k * spacing);
    while (seg < pts.length - 2 && cumulative[seg + 1]! < d) seg++;
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    const segLen = cumulative[seg + 1]! - cumulative[seg]!;
    const f = segLen > 0 ? (d - cumulative[seg]!) / segLen : 0;
    const t = a.t + (b.t - a.t) * f;
    samples.push({
      atS: Math.min(lastS, Math.max(0, t / 1000)),
      location: { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f },
      distanceM: d,
    });
  }
  return samples;
}
