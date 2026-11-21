"use client";

import type * as MapLibre from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "../mapcn/Map";

/** Hands the MapLibre instance to a parent that needs to read the crosshair position. */
export function MapHandle({ onMap }: { onMap: (map: MapLibre.Map) => void }) {
  const { map } = useMap();
  useEffect(() => {
    onMap(map);
    // onMap is called once per map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}
