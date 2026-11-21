import type { LatLon } from "../domain/types.js";

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). Error is well under 1 m at the 500 m scale Locus works at. */
export function distanceM(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
