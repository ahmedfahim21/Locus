import type { LatLon } from "../domain/types.js";

/**
 * The home state's language, added to Hindi on landmark names (typed, walk video,
 * photos) so a rider can read them on the map in his own script.
 */
export type LocalLanguage = {
  code: "te" | "kn";
  name: "Telugu" | "Kannada";
  /** Sarvam transliterate target. */
  sarvam: "te-IN" | "kn-IN";
  /** Every letter of a name in this language is in this Unicode block. */
  script: RegExp;
  /** OSM tag with the name in this language. */
  osmTag: string;
};

export const TELUGU: LocalLanguage = { code: "te", name: "Telugu", sarvam: "te-IN", script: /[ఀ-౿]/, osmTag: "name:te" };
export const KANNADA: LocalLanguage = { code: "kn", name: "Kannada", sarvam: "kn-IN", script: /[ಀ-೿]/, osmTag: "name:kn" };
export const LOCAL_LANGUAGES = [TELUGU, KANNADA];

/**
 * Simplified state outlines as [lat, lon] rings, accurate to a few kilometres: enough
 * for a city or town, not for a house on a border. Checked against the cities in
 * test/region.test.ts. Add a state here (and its language above) to support it.
 */
const STATES: { name: string; language: LocalLanguage; ring: [number, number][] }[] = [
  {
    name: "Telangana",
    language: TELUGU,
    ring: [
      [19.92, 78.4], [19.5, 79.9], [18.9, 80.3], [18.3, 80.9], [17.6, 81.1], [17.1, 80.9], [16.9, 80.4], [16.6, 79.9],
      [16.3, 79.0], [15.85, 78.1], [16.2, 77.45], [17.0, 77.45], [17.7, 77.55], [18.4, 77.75], [18.9, 77.8],
    ],
  },
  {
    name: "Andhra Pradesh",
    language: TELUGU,
    ring: [
      [19.15, 84.75], [18.3, 84.1], [17.6, 83.3], [16.9, 82.3], [16.3, 81.6], [15.8, 80.9], [15.2, 80.1], [14.4, 80.2],
      [13.45, 80.35], [13.4, 80.0], [13.2, 79.5], [13.0, 79.0], [12.62, 78.45], [12.88, 78.38], [13.0, 78.4], [13.4, 78.1],
      [13.75, 77.55], [14.1, 77.3], [14.6, 77.05], [15.1, 77.05], [15.6, 77.05], [15.95, 77.4], [15.85, 78.1], [16.3, 79.0],
      [16.6, 79.9], [16.9, 80.4], [17.1, 80.9], [17.6, 81.1], [17.9, 81.7], [18.2, 82.4], [18.5, 83.0], [18.9, 83.5], [19.1, 84.2],
    ],
  },
  {
    name: "Karnataka",
    language: KANNADA,
    ring: [
      [18.45, 77.1], [18.4, 77.75], [17.7, 77.55], [17.0, 77.45], [16.2, 77.45], [15.95, 77.4], [15.6, 77.05], [15.1, 77.05], [14.6, 77.05],
      [14.1, 77.3], [13.75, 77.55], [13.4, 78.1], [13.0, 78.4], [12.88, 78.38], [12.8, 78.1], [12.8, 77.85], [12.76, 77.78], [12.6, 77.6], [12.5, 77.55],
      [12.15, 77.75], [11.75, 77.45], [11.55, 76.95], [11.65, 76.4], [12.0, 75.9], [12.6, 75.2], [12.8, 74.85],
      [13.9, 74.55], [14.8, 74.1], [15.1, 74.25], [15.75, 74.35], [16.4, 74.25], [16.8, 75.3], [17.3, 75.7],
      [17.6, 76.3], [18.1, 76.9],
    ],
  },
];

function inside(point: LatLon, ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The state a point is in, among the ones Locus has a language for; null elsewhere (Hindi only). */
export function stateAt(point: LatLon): { name: string; language: LocalLanguage } | null {
  const state = STATES.find((s) => inside(point, s.ring));
  return state ? { name: state.name, language: state.language } : null;
}

export function localLanguageAt(point: LatLon): LocalLanguage | null {
  return stateAt(point)?.language ?? null;
}

/** The local language whose script a name is written in, if any. */
export function languageOfScript(name: string): LocalLanguage | null {
  return LOCAL_LANGUAGES.find((l) => l.script.test(name)) ?? null;
}
