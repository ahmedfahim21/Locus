import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/**
 * The map (DESIGN.md "Map"): Sadak's game-map palette. Dark: charcoal ground and
 * blocks, gold main roads, pale secondaries, grey lanes in dark casings. Light:
 * the same structure on a pale ground. Route, rider, door keep their meanings.
 */
const DARK = {
  ground: "#20252c",
  building: "#363e49",
  buildingEdge: "#262c34",
  building3d: "#3b4451",
  water: "#1e5a88",
  shore: "#4a92c6",
  park: "#2c5836",
  pitch: "#346a3d",
  casing: "#0f1216",
  primary: "#f0c75e",
  primaryCasing: "#0f1216",
  secondary: "#e3e8ee",
  lane: "#a3adb8",
  path: "#b9a58a",
  rail: "#6b7480",
  label: "#dfe5ec",
  labelMuted: "#a3adb8",
  labelHalo: "#0f1216",
  waterLabel: "#9fd3ff",
  poi: "#f3d27a",
  route: "#5ab0ff",
  routeCasing: "#0f1216",
  walked: "#3ddc84",
};

const LIGHT: typeof DARK = {
  ground: "#eceef1",
  building: "#dde1e6",
  buildingEdge: "#c9cfd6",
  building3d: "#e3e7ec",
  water: "#a7d3f2",
  shore: "#6fb1e0",
  park: "#c7e6bd",
  pitch: "#b5dca8",
  casing: "#c3cad3",
  primary: "#f5c84c",
  primaryCasing: "#d69f1d",
  secondary: "#ffffff",
  lane: "#ffffff",
  path: "#d9c7a8",
  rail: "#a3adb8",
  label: "#2b323c",
  labelMuted: "#6b7480",
  labelHalo: "#ffffff",
  waterLabel: "#2f6fa6",
  poi: "#a8740a",
  route: "#2f7df6",
  routeCasing: "#ffffff",
  walked: "#1fb257",
};

export type MapColors = typeof DARK;
export const MAP_PALETTES = { dark: DARK, light: LIGHT } as const;

const width = (z14: number, z18: number) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, z14 * 0.35, 14, z14, 18, z18] as never;
/** Latin-script name first: the map fonts don't cover Devanagari or Kannada. */
const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]] as never;
const FONT = ["Noto Sans Regular"];

const ROADS: [id: string, classes: string[], fill: keyof MapColors, casing: keyof MapColors, w14: number, w18: number][] = [
  ["path", ["path", "track"], "path", "casing", 0.6, 2.5],
  ["lane", ["minor", "service"], "lane", "casing", 1.2, 7],
  ["secondary", ["secondary", "tertiary"], "secondary", "casing", 2, 11],
  ["primary", ["motorway", "trunk", "primary"], "primary", "primaryCasing", 2.6, 14],
];

export function sadakStyle(c: MapColors): StyleSpecification {
  const roads = ROADS.flatMap(([id, classes, fill, casing, w14, w18]) => [
    {
      id: `${id}-casing`,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c[casing], "line-width": width(w14 + 1.6, w18 + 4) },
    },
    {
      id,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c[fill], "line-width": width(w14, w18) },
    },
  ]);
  const halo = { "text-halo-color": c.labelHalo, "text-halo-width": 1.6, "text-halo-blur": 0.4 };
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap contributors · OpenFreeMap" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.ground } },
      { id: "landcover", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland"]]], paint: { "fill-color": c.park, "fill-opacity": 0.55 } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": c.park } },
      { id: "pitch", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["pitch", "stadium"]]], paint: { "fill-color": c.pitch } },
      { id: "water-shore", type: "line", source: "omt", "source-layer": "water", paint: { "line-color": c.shore, "line-width": 1.5 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
      { id: "buildings", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": c.building, "fill-outline-color": c.buildingEdge } },
      {
        // The 3D view (DESIGN.md "Map"): hidden until switched on.
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "omt",
        "source-layer": "building",
        minzoom: 14,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": c.building3d,
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6] as never,
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0] as never,
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      { id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": c.rail, "line-width": 1.2, "line-dasharray": [3, 2] } },
      ...roads,
      {
        id: "label-water",
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12 },
        paint: { "text-color": c.waterLabel, ...halo },
      },
      {
        id: "label-street",
        type: "symbol",
        source: "omt",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13] as never,
          "text-letter-spacing": 0.02,
          "symbol-spacing": 320,
        },
        paint: { "text-color": c.label, ...halo },
      },
      {
        id: "label-poi",
        type: "symbol",
        source: "omt",
        "source-layer": "poi",
        minzoom: 15,
        filter: ["<=", ["get", "rank"], 20],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": 11, "text-max-width": 8, "text-anchor": "top", "text-offset": [0, 0.2] },
        paint: { "text-color": c.poi, ...halo },
      },
      {
        id: "label-place",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter", "town", "village"]]],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": 13, "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
        paint: { "text-color": c.labelMuted, ...halo },
      },
    ] as StyleSpecification["layers"],
  };
}

/** Repaints a loaded map for the other theme without reloading tiles. */
export function applyBasePalette(map: MapLibreMap, c: MapColors) {
  const set = (id: string, prop: string, value: string) => {
    if (map.getLayer(id)) (map.setPaintProperty as (l: string, p: string, v: unknown) => void).call(map, id, prop, value);
  };
  set("bg", "background-color", c.ground);
  set("landcover", "fill-color", c.park);
  set("park", "fill-color", c.park);
  set("pitch", "fill-color", c.pitch);
  set("water-shore", "line-color", c.shore);
  set("water", "fill-color", c.water);
  set("buildings", "fill-color", c.building);
  set("buildings", "fill-outline-color", c.buildingEdge);
  set("buildings-3d", "fill-extrusion-color", c.building3d);
  set("rail", "line-color", c.rail);
  for (const [id, , fill, casing] of ROADS) {
    set(id, "line-color", c[fill]);
    set(`${id}-casing`, "line-color", c[casing]);
  }
  for (const id of ["label-water", "label-street", "label-poi", "label-place"]) set(id, "text-halo-color", c.labelHalo);
  set("label-water", "text-color", c.waterLabel);
  set("label-street", "text-color", c.label);
  set("label-poi", "text-color", c.poi);
  set("label-place", "text-color", c.labelMuted);
}
