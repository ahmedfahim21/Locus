/**
 * India Post DIGIPIN, ported from the official implementation
 * (https://github.com/INDIAPOST-gov/digipin, src/digipin.js, Apache-2.0).
 * Canonical form: 10 characters, no separators.
 */
import type { LatLon } from "../domain/types.js";

const GRID = [
  ["F", "C", "9", "8"],
  ["J", "3", "2", "7"],
  ["K", "4", "5", "6"],
  ["L", "M", "P", "T"],
] as const;

const BOUNDS = { minLat: 2.5, maxLat: 38.5, minLon: 63.5, maxLon: 99.5 };

export function encodeDigipin({ lat, lon }: LatLon): string {
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat) throw new RangeError("Latitude out of range");
  if (lon < BOUNDS.minLon || lon > BOUNDS.maxLon) throw new RangeError("Longitude out of range");
  let { minLat, maxLat, minLon, maxLon } = BOUNDS;
  let pin = "";
  for (let level = 1; level <= 10; level++) {
    const latDiv = (maxLat - minLat) / 4;
    const lonDiv = (maxLon - minLon) / 4;
    const row = Math.max(0, Math.min(3 - Math.floor((lat - minLat) / latDiv), 3));
    const col = Math.max(0, Math.min(Math.floor((lon - minLon) / lonDiv), 3));
    pin += GRID[row]![col]!;
    maxLat = minLat + latDiv * (4 - row);
    minLat = minLat + latDiv * (3 - row);
    minLon = minLon + lonDiv * col;
    maxLon = minLon + lonDiv;
  }
  return pin;
}

/** Centre of the DIGIPIN's level-10 cell. */
export function decodeDigipin(digipin: string): LatLon {
  const pin = digipin.trim().toUpperCase();
  if (!/^[23456789CJKLMPFT]{10}$/.test(pin)) throw new RangeError("Invalid DIGIPIN");
  let { minLat, maxLat, minLon, maxLon } = BOUNDS;
  for (const ch of pin) {
    const ri = GRID.findIndex((row) => (row as readonly string[]).includes(ch));
    const ci = (GRID[ri] as readonly string[]).indexOf(ch);
    const latDiv = (maxLat - minLat) / 4;
    const lonDiv = (maxLon - minLon) / 4;
    const lat1 = maxLat - latDiv * (ri + 1);
    const lat2 = maxLat - latDiv * ri;
    const lon1 = minLon + lonDiv * ci;
    const lon2 = minLon + lonDiv * (ci + 1);
    minLat = lat1;
    maxLat = lat2;
    minLon = lon1;
    maxLon = lon2;
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}
