"use client";

import { ArrowLeft, Crosshair } from "@phosphor-icons/react";
import type * as MapLibre from "maplibre-gl";
import { useRef, useState, type ReactNode } from "react";
import type { LatLon } from "../../lib/api";
import { Map } from "../mapcn/Map";
import { MapHandle } from "./MapHandle";

const BENGALURU: LatLon = { lat: 12.9716, lon: 77.5946 };

export function DoorStep({
  initial,
  progress,
  onBack,
  onDone,
}: {
  initial: LatLon | null;
  progress: ReactNode;
  onBack: () => void;
  onDone: (door: LatLon) => void;
}) {
  const map = useRef<MapLibre.Map | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  function useMyLocation() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("This browser can't share your location. Move the map by hand.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        map.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 18, duration: 900 });
      },
      (err) => {
        console.error("[geo] getCurrentPosition failed", err);
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? "Location permission is off. Move the map by hand." : `Couldn't find you: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function confirm() {
    const center = map.current?.getCenter();
    if (!center) return;
    onDone({ lat: center.lat, lon: center.lng });
  }

  return (
    <main className="setup">
      <div className="setup-map">
        <Map center={initial ?? BENGALURU} zoom={initial ? 18 : 12} className="fill" label="Move the map so the white pin sits on your gate">
          <MapHandle
            onMap={(m) => {
              map.current = m;
              setMapReady(true);
            }}
          />
        </Map>
        <div className="crosshair" aria-hidden="true"><span className="head" /><span className="stem" /><span className="foot" /></div>
        <div className="poster glass">
          <div className="street">Where should the rider stop?</div>
          <div className="label">Move the map until the pin sits on your gate.</div>
        </div>
      </div>
      <aside className="setup-panel">
        <div className="topbar">
          <button className="btn icon" type="button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          {progress}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="title">Your gate</h1>
          <p className="muted">
            Zoom in until you can see your lane. Put the pin where a rider should stop and hand over the parcel: the gate, not
            the middle of the building.
          </p>
        </div>
        {error && (
          <div className="alert warn" role="alert">
            <span>{error}</span>
          </div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn block" type="button" onClick={useMyLocation} disabled={!mapReady || locating}>
            <Crosshair size={18} />
            {locating ? "Finding you…" : "Use my location"}
          </button>
          <button className="btn primary block" type="button" onClick={confirm} disabled={!mapReady}>
            This is my gate
          </button>
        </div>
      </aside>
    </main>
  );
}
