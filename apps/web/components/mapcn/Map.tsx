"use client";

// Adapted from mapcn's MIT-licensed Map and MapMarker registry components.
// https://github.com/AnmolSaini16/mapcn · See LICENSE in this directory.
// Locus additions: the Sadak-coloured style (DESIGN.md "Map"), fit-to-points,
// and the route with the rider's walked trail.
import type * as MapLibre from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LatLon, RouteLeg } from "../../lib/api";
import { Cube } from "@phosphor-icons/react";
import { applyBasePalette, MAP_PALETTES, sadakStyle, type MapColors } from "../../lib/mapStyle";
import { propsCollection, type Prop3D } from "../../lib/props3d";
import { useTheme } from "../../lib/theme";

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
  const { theme } = useTheme();
  const colors = theme ? MAP_PALETTES[theme] : null;
  const startColors = useRef<MapColors | null>(null);
  if (colors && !startColors.current) startColors.current = colors;
  const ready = colors !== null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let map: MapLibre.Map | undefined;
    const start = startColors.current!;

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
          style: sadakStyle(start),
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
          if (!cancelled) setContext({ map: loaded, lib, colors: start });
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
  }, [ready]);

  // Light ↔ dark: repaint in place; route layers follow through the context.
  useEffect(() => {
    if (!context || !colors || context.colors === colors) return;
    applyBasePalette(context.map, colors);
    setContext({ ...context, colors });
  }, [colors, context]);

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
/**
 * Padding sized for a desktop map, scaled down to the map actually on screen: on a
 * phone, 220 px of label room on a 300 px-wide map would leave no room for the route.
 */
/** How far FitTo may zoom in; 17.5 left a 100 m route's pins on top of each other. */
export const FIT_MAX_ZOOM = 19;

export function fitPadding(padding: MapLibre.PaddingOptions | number, width: number, height: number): MapLibre.PaddingOptions {
  const p = typeof padding === "number" ? { top: padding, bottom: padding, left: padding, right: padding } : padding;
  const cap = (v: number | undefined, max: number) => Math.round(Math.max(0, Math.min(v ?? 0, max)));
  return { top: cap(p.top, height * 0.22), bottom: cap(p.bottom, height * 0.14), left: cap(p.left, width * 0.12), right: cap(p.right, width * 0.28) };
}

export function FitTo({ points, padding }: { points: LatLon[]; padding: MapLibre.PaddingOptions | number }) {
  const { map, lib } = useMap();
  const key = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const paddingKey = JSON.stringify(padding);
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new lib.LngLatBounds();
    for (const p of points) bounds.extend([p.lon, p.lat]);
    const fit = () => {
      const el = map.getContainer();
      // Up to zoom 19: a route of a hundred metres (a campus, a lane) still spreads its pins apart.
      map.fitBounds(bounds, { padding: fitPadding(JSON.parse(paddingKey), el.clientWidth, el.clientHeight), maxZoom: FIT_MAX_ZOOM, duration: 0 });
    };
    fit();
    // Phones rotate and panels change height: fit again to the new size.
    map.on("resize", fit);
    return () => {
      map.off("resize", fit);
    };
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
    map.addLayer({ id: `${id}-edge`, type: "line", source: id, filter: roads, layout: round, paint: { "line-color": colors.routeCasing, "line-width": 10 } });
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

  useEffect(() => {
    const set = (layer: string, value: string) => {
      if (map.getLayer(`${id}-${layer}`)) map.setPaintProperty(`${id}-${layer}`, "line-color", value);
    };
    set("glow", colors.route);
    set("edge", colors.routeCasing);
    set("ink", colors.route);
    set("trail", colors.walked);
    set("gap", colors.route);
  }, [map, id, colors]);


  return null;
}

/**
 * The 3D view as a neighbourhood diorama (DESIGN.md "Map"): only the area around
 * the route is drawn in detail. Buildings rise inside it, everything outside is
 * masked, base labels other than street names are hidden so only Locus's
 * landmarks are named, the home building is picked out, and each landmark
 * stands up as a prop in its colour.
 */
export function Map3D({ props, focus, area, initiallyOn = false }: { props: Prop3D[]; focus: LatLon; area: LatLon[]; initiallyOn?: boolean }) {
  const { map, colors } = useMap();
  const [on, setOn] = useState(initiallyOn);
  const flat = useRef<{ center: MapLibre.LngLat; zoom: number } | null>(null);
  const id = useRef(`props-${Math.random().toString(36).slice(2)}`).current;
  const key = JSON.stringify(props);
  const areaKey = JSON.stringify([focus, area]);

  useEffect(() => {
    map.addSource(id, { type: "geojson", data: propsCollection(JSON.parse(key) as Prop3D[]) as never });
    map.addLayer({
      id,
      type: "fill-extrusion",
      source: id,
      layout: { visibility: on ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.96,
      },
    });
    return () => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    };
    // Visibility is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id, key]);

  useEffect(() => {
    const show = (layer: string, visible: boolean) => {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    };
    const maskId = `${id}-mask`;
    const homeId = `${id}-home`;
    const remove = (layer: string) => {
      if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(layer)) map.removeSource(layer);
    };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const move = (camera: MapLibre.JumpToOptions) => (reduce ? map.jumpTo(camera) : map.easeTo({ ...camera, duration: 1200 }));

    if (on) {
      const { center, radiusM } = dioramaArea(focus, [...area, ...(JSON.parse(key) as Prop3D[]).map((p) => p.location)]);
      const circle = circleRing(center, radiusM);
      // Pick out the home building while the map is still flat (before tilting).
      const home = map
        .queryRenderedFeatures(map.project([focus.lon, focus.lat]), { layers: ["buildings"] })
        .find((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
      flat.current = { center: map.getCenter(), zoom: map.getZoom() };

      // Order, bottom to top: base map, 3D buildings, the mask (its hole shows the
      // neighbourhood, it fades everything outside), the home building, the route, props.
      const firstRouteLayer = map.getStyle().layers.find((l) => l.id.endsWith("-glow"))?.id;
      map.moveLayer("buildings-3d", firstRouteLayer);
      map.addSource(maskId, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [worldRing(center), [...circle].reverse()] } } as never,
      });
      map.addLayer({ id: maskId, type: "fill", source: maskId, paint: { "fill-color": colors.ground, "fill-opacity": 0.92 } }, firstRouteLayer);
      if (home) {
        map.addSource(homeId, { type: "geojson", data: { type: "Feature", properties: {}, geometry: home.geometry } as never });
        map.addLayer(
          {
            id: homeId,
            type: "fill-extrusion",
            source: homeId,
            paint: {
              "fill-extrusion-color": colors.route,
              "fill-extrusion-height": Number(home.properties?.render_height ?? 9),
              "fill-extrusion-base": Number(home.properties?.render_min_height ?? 0),
              "fill-extrusion-opacity": 0.95,
            },
          },
          firstRouteLayer,
        );
      }
      for (const l of ["label-poi", "label-place", "label-water"]) show(l, false);
      show("buildings-3d", true);
      show("buildings", false);
      show(id, true);
      const bounds = new (map.getBounds().constructor as typeof MapLibre.LngLatBounds)();
      for (const [lon, lat] of circle) bounds.extend([lon!, lat!]);
      const camera = map.cameraForBounds(bounds, { padding: 40, bearing: -24 });
      move({ ...camera, zoom: (camera?.zoom ?? 17) + 0.4, pitch: 58, bearing: -24 });
    } else {
      remove(maskId);
      remove(homeId);
      for (const l of ["label-poi", "label-place", "label-water"]) show(l, true);
      show("buildings-3d", false);
      show("buildings", true);
      show(id, false);
      if (flat.current) move({ pitch: 0, bearing: 0, center: flat.current.center, zoom: flat.current.zoom });
    }
    // Pins float above their props on a stem (globals.css ".is-3d").
    map.getContainer().classList.toggle("is-3d", on);
    return () => {
      remove(maskId);
      remove(homeId);
    };
    // Rebuilt only when switched or when the route area changes; theme colours are repainted below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id, on, areaKey]);

  useEffect(() => {
    if (map.getLayer(`${id}-mask`)) map.setPaintProperty(`${id}-mask`, "fill-color", colors.ground);
    if (map.getLayer(`${id}-home`)) map.setPaintProperty(`${id}-home`, "fill-extrusion-color", colors.route);
  }, [map, id, colors]);

  return (
    <button
      type="button"
      className="map-3d-toggle glass"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      title={on ? "Back to the flat map" : "See your street in 3D"}
    >
      <Cube size={16} />
      {on ? "2D" : "3D"}
    </button>
  );
}

/** The diorama's circle: centred on the route's extent, just big enough to hold it (150–450 m). */
function dioramaArea(focus: LatLon, points: LatLon[]): { center: LatLon; radiusM: number } {
  const all = [focus, ...points];
  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  const far = Math.max(...all.map((p) => metres(center, p)));
  return { center, radiusM: Math.min(450, Math.max(150, far + 70)) };
}

function metres(a: LatLon, b: LatLon) {
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
}

function circleRing(c: LatLon, radiusM: number, steps = 72): number[][] {
  const mLon = 111_320 * Math.cos((c.lat * Math.PI) / 180);
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([c.lon + (Math.cos(a) * radiusM) / mLon, c.lat + (Math.sin(a) * radiusM) / 111_320]);
  }
  return ring;
}

/** A square far bigger than the view, as the outer edge of the mask. */
function worldRing(c: LatLon): number[][] {
  const d = 0.3;
  return [[c.lon - d, c.lat - d], [c.lon + d, c.lat - d], [c.lon + d, c.lat + d], [c.lon - d, c.lat + d], [c.lon - d, c.lat - d]];
}
