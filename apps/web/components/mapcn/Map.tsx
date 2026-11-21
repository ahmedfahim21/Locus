"use client";

// Adapted from mapcn's MIT-licensed Map and MapMarker registry components.
// https://github.com/AnmolSaini16/mapcn · See LICENSE in this directory.
// Locus additions: the Sadak-coloured style (DESIGN.md "Map"), fit-to-points,
// and the route with the rider's walked trail.
import type * as MapLibre from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LatLon, RouteLeg } from "../../lib/api";
import { MAP, sadakStyle, type MapColors } from "../../lib/mapStyle";

type MapContextValue = { map: MapLibre.Map; lib: typeof MapLibre; colors: MapColors };
const MapContext = createContext<MapContextValue | null>(null);

export function useMap() {
  const context = useContext(MapContext);
  if (!context) throw new Error("Map components must be children of Map.");
  return context;
}

type MapProps = {
  center: LatLon;
  zoom: number;
  /** Zoom buttons and panning. Off for display-only maps. */
  interactive?: boolean;
  className?: string;
  label: string;
  children?: ReactNode;
};

export function Map({ center, zoom, interactive = true, className = "", label, children }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const initial = useRef({ center, zoom, interactive });
  const [context, setContext] = useState<MapContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibre.Map | undefined;

    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        // MapLibre v6 distributes its renderer worker separately.
        if (!lib.getWorkerUrl()) {
          lib.setWorkerUrl(`https://unpkg.com/maplibre-gl@${lib.getVersion()}/dist/maplibre-gl-worker.mjs`);
        }
        const { center: c, zoom: z, interactive: i } = initial.current;
        map = new lib.Map({
          container: container.current,
          style: sadakStyle(),
          center: [c.lon, c.lat],
          zoom: z,
          interactive: i,
          renderWorldCopies: false,
          attributionControl: { compact: true },
          cooperativeGestures: false,
        });
        if (i) map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
        map.on("error", (e) => console.error("[map]", e.error));
        const loaded = map;
        loaded.once("load", () => {
          if (!cancelled) setContext({ map: loaded, lib, colors: MAP });
        });
      })
      .catch((err: unknown) => {
        console.error("[map] failed to start", err);
        map?.remove();
        map = undefined;
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return (
    <div className={`map ${className}`} role="region" aria-label={label}>
      <div ref={container} className="map-canvas" />
      {!context && (
        <div className="map-status" role="status">
          {error ? `The map couldn't load: ${error}` : <div className="skeleton" style={{ width: 160 }} />}
        </div>
      )}
      {context && <MapContext.Provider value={context}>{children}</MapContext.Provider>}
    </div>
  );
}

export function MapMarker({
  at,
  offset,
  anchor = "center",
  children,
}: {
  at: LatLon;
  offset?: [number, number];
  anchor?: MapLibre.PositionAnchor;
  children: ReactNode;
}) {
  const { map, lib } = useMap();
  const [element] = useState(() => document.createElement("div"));
  const [marker] = useState(() => new lib.Marker({ element, offset, anchor }).setLngLat([at.lon, at.lat]));

  useEffect(() => {
    marker.addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, marker]);

  useEffect(() => {
    marker.setLngLat([at.lon, at.lat]);
  }, [at.lat, at.lon, marker]);

  return createPortal(children, element);
}

/** Frames the given points once they're known (and again if they change). */
export function FitTo({ points, padding }: { points: LatLon[]; padding: MapLibre.PaddingOptions | number }) {
  const { map, lib } = useMap();
  const key = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const paddingKey = JSON.stringify(padding);
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new lib.LngLatBounds();
    for (const p of points) bounds.extend([p.lon, p.lat]);
    map.fitBounds(bounds, { padding: JSON.parse(paddingKey), maxZoom: 17.5, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paddingKey, map, lib]);
  return null;
}

type LineFeature = { type: "Feature"; properties: { onRoads: boolean }; geometry: { type: "LineString"; coordinates: number[][] } };
type LineCollection = { type: "FeatureCollection"; features: LineFeature[] };

const toCoords = (line: LatLon[]) => line.map((p) => [p.lon, p.lat]);

function legsCollection(legs: RouteLeg[], pointBudget = Infinity): LineCollection {
  const features: LineFeature[] = [];
  let left = pointBudget;
  for (const leg of legs) {
    if (left < 2) break;
    const coords = toCoords(leg.line).slice(0, left);
    left -= coords.length;
    features.push({ type: "Feature", properties: { onRoads: leg.onRoads }, geometry: { type: "LineString", coordinates: coords } });
  }
  return { type: "FeatureCollection", features };
}

/**
 * The inked route (DESIGN.md "Elevation & Depth"): ink edge, paper road band,
 * ballpoint line on top. Legs with no road connection are drawn dashed. The
 * turmeric trail covers the legs the rider has already walked.
 */
export function MapRoute({ legs, walkedLegs = 0, drawIn = false }: { legs: RouteLeg[]; walkedLegs?: number; drawIn?: boolean }) {
  const { map, colors } = useMap();
  const id = useRef(`route-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    map.addSource(id, { type: "geojson", data: legsCollection(legs, drawIn ? 2 : Infinity) });
    map.addSource(`${id}-trail`, { type: "geojson", data: legsCollection([]) });
    const roads: MapLibre.FilterSpecification = ["==", ["get", "onRoads"], true];
    const gaps: MapLibre.FilterSpecification = ["==", ["get", "onRoads"], false];
    const round = { "line-cap": "round", "line-join": "round" } as const;
    map.addLayer({ id: `${id}-glow`, type: "line", source: id, filter: roads, layout: round, paint: { "line-color": colors.route, "line-width": 16, "line-opacity": 0.18, "line-blur": 4 } });
    map.addLayer({ id: `${id}-edge`, type: "line", source: id, filter: roads, layout: round, paint: { "line-color": colors.casing, "line-width": 10 } });
    map.addLayer({ id: `${id}-ink`, type: "line", source: id, filter: roads, layout: round, paint: { "line-color": colors.route, "line-width": 6 } });
    map.addLayer({ id: `${id}-trail`, type: "line", source: `${id}-trail`, layout: round, paint: { "line-color": colors.walked, "line-width": 6 } });
    map.addLayer({ id: `${id}-gap`, type: "line", source: id, filter: gaps, layout: round, paint: { "line-color": colors.route, "line-width": 3, "line-dasharray": [1, 2] } });
    return () => {
      for (const layer of ["gap", "trail", "ink", "edge", "glow"]) if (map.getLayer(`${id}-${layer}`)) map.removeLayer(`${id}-${layer}`);
      if (map.getSource(`${id}-trail`)) map.removeSource(`${id}-trail`);
      if (map.getSource(id)) map.removeSource(id);
    };
    // Sources are created once per map; data updates happen below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);

  // The route inks itself in (the authored moment), or appears at once under reduced motion.
  useEffect(() => {
    const source = map.getSource(id) as MapLibre.GeoJSONSource | undefined;
    if (!source) return;
    const total = legs.reduce((n, l) => n + l.line.length, 0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!drawIn || reduce || total < 3) {
      source.setData(legsCollection(legs));
      return;
    }
    let frame = 0;
    const started = performance.now();
    const DURATION = 1800;
    const step = (t: number) => {
      const k = Math.min(1, (t - started) / DURATION);
      source.setData(legsCollection(legs, Math.max(2, Math.round(total * k))));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [map, id, legs, drawIn]);

  useEffect(() => {
    const trail = map.getSource(`${id}-trail`) as MapLibre.GeoJSONSource | undefined;
    trail?.setData(legsCollection(legs.slice(0, walkedLegs)));
  }, [map, id, legs, walkedLegs]);


  return null;
}
