import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useState } from "react";

/** Map colours, read from the CSS tokens so the map follows the light/night card. */
export type MapColors = {
  card: string;
  paper: string;
  ghost: string;
  ghostDeep: string;
  ink: string;
  ballpoint: string;
  turmeric: string;
};

export function readMapColors(): MapColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => {
    const value = css.getPropertyValue(`--${name}`).trim();
    if (!value) throw new Error(`Design token --${name} is not defined`);
    return value;
  };
  return {
    card: v("card"),
    paper: v("paper"),
    ghost: v("ghost"),
    ghostDeep: v("ghost-deep"),
    ink: v("ink"),
    ballpoint: v("ballpoint"),
    turmeric: v("turmeric"),
  };
}

/** Re-reads the colours when the system switches between light and night. */
export function useMapColors(): MapColors | null {
  const [colors, setColors] = useState<MapColors | null>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColors(readMapColors());
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return colors;
}

/**
 * The "wedding-card" base map (DESIGN.md): OpenFreeMap vector tiles with every
 * road and park faded into the card. No labels, no buildings: only the route
 * Locus draws on top is inked.
 */
export function weddingCardStyle(c: MapColors): StyleSpecification {
  return {
    version: 8,
    sources: {
      omt: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: "© OpenStreetMap contributors · OpenFreeMap",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.card } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": c.ghost, "fill-opacity": 0.7 } },
      { id: "landcover", type: "fill", source: "omt", "source-layer": "landcover", paint: { "fill-color": c.ghost, "fill-opacity": 0.35 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.ghostDeep } },
      {
        id: "roads",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.ghostDeep,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 1, 18, 7],
        },
      },
    ],
  };
}

/** Repaints an already-loaded map with new colours (light ↔ night) without reloading tiles. */
export function recolorBaseMap(map: import("maplibre-gl").Map, c: MapColors) {
  const set = (id: string, prop: "background-color" | "fill-color" | "line-color", value: string) => {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
  };
  set("bg", "background-color", c.card);
  set("park", "fill-color", c.ghost);
  set("landcover", "fill-color", c.ghost);
  set("water", "fill-color", c.ghostDeep);
  set("roads", "line-color", c.ghostDeep);
}
