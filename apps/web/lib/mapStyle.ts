import type { StyleSpecification } from "maplibre-gl";

/**
 * The map (DESIGN.md "Map"): Sadak's game-map palette. Dark ground and blocks,
 * gold main roads, pale secondaries, grey lanes in dark casings, blue water,
 * green parks. The same in light and dark mode, so the route always reads.
 */
export const MAP = {
  outside: "#161a20",
  ground: "#20252c",
  building: "#363e49",
  buildingEdge: "#262c34",
  water: "#1e5a88",
  shore: "#4a92c6",
  park: "#2c5836",
  pitch: "#346a3d",
  casing: "#0f1216",
  primary: "#f0c75e",
  secondary: "#e3e8ee",
  lane: "#a3adb8",
  path: "#b9a58a",
  rail: "#6b7480",
  route: "#5ab0ff",
  walked: "#3ddc84",
} as const;

export type MapColors = typeof MAP;

/** Kept as a hook so map components read colours one way; the palette does not change with the theme. */
export function useMapColors(): MapColors {
  return MAP;
}

const width = (z14: number, z18: number) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, z14 * 0.35, 14, z14, 18, z18] as never;

export function sadakStyle(): StyleSpecification {
  const roads = (id: string, classes: string[], fill: string, w14: number, w18: number) => [
    {
      id: `${id}-casing`,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": MAP.casing, "line-width": width(w14 + 1.6, w18 + 4) },
    },
    {
      id,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": fill, "line-width": width(w14, w18) },
    },
  ];
  return {
    version: 8,
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap contributors · OpenFreeMap" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": MAP.ground } },
      { id: "landcover", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland"]]], paint: { "fill-color": MAP.park, "fill-opacity": 0.55 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": MAP.park } },
      { id: "pitch", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["pitch", "stadium"]]], paint: { "fill-color": MAP.pitch } },
      { id: "water-shore", type: "line", source: "omt", "source-layer": "water", paint: { "line-color": MAP.shore, "line-width": 1.5 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": MAP.water } },
      {
        id: "buildings",
        type: "fill",
        source: "omt",
        "source-layer": "building",
        minzoom: 14,
        paint: { "fill-color": MAP.building, "fill-outline-color": MAP.buildingEdge },
      },
      { id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": MAP.rail, "line-width": 1.2, "line-dasharray": [3, 2] } },
      ...roads("path", ["path", "track"], MAP.path, 0.6, 2.5),
      ...roads("lane", ["minor", "service"], MAP.lane, 1.2, 7),
      ...roads("secondary", ["secondary", "tertiary"], MAP.secondary, 2, 11),
      ...roads("primary", ["motorway", "trunk", "primary"], MAP.primary, 2.6, 14),
    ] as StyleSpecification["layers"],
  };
}
