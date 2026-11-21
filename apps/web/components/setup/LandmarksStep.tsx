"use client";

import { ArrowDown, ArrowLeft, ArrowUp, MapPin, Plus, Trash } from "@phosphor-icons/react";
import type * as MapLibre from "maplibre-gl";
import { useRef, useState, type ReactNode } from "react";
import { api, scriptNames, type CueInput, type LatLon, type Me } from "../../lib/api";
import type { KeptProposal } from "./WalkStep";
import { Map, MapMarker } from "../mapcn/Map";
import { Stamp } from "../RouteMap";
import { MapHandle } from "./MapHandle";

const MAX_LANDMARKS = 8; // Same cap as the API (MAX_CUES).

type Draft = {
  key: number;
  landmark: string;
  text: string;
  location: LatLon;
  /** Set for landmarks from the walk video: keeps the photo and the names the API stored. */
  proposalId: string | null;
  photoUrl: string | null;
  alt: { text: string; script: "deva" | "knda" }[];
};

/** Same threshold as the API's route: a landmark this close to the door is the door. */
const DOOR_SAME_AS_LANDMARK_M = 15;

function metresBetween(a: LatLon, b: LatLon) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** A starting instruction for a walk-video landmark, said once the rider is there; the recipient edits it before saving. */
const suggestedText = (name: string) => `${name} ke baad seedha aaiye.`;

export function LandmarksStep({
  me,
  door,
  fromWalk,
  progress,
  onBack,
  onDone,
}: {
  me: Me;
  door: LatLon;
  fromWalk: KeptProposal[];
  progress: ReactNode;
  onBack: () => void;
  onDone: () => void;
}) {
  const map = useRef<MapLibre.Map | null>(null);
  const nextKey = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const existing: Draft[] = (me.home?.cues ?? []).map((c) => ({
      key: nextKey.current++,
      landmark: c.landmark,
      text: c.text,
      location: c.location,
      proposalId: c.proposalId,
      photoUrl: c.photoUrl,
      alt: scriptNames(c.aliases),
    }));
    const have = new Set(existing.flatMap((d) => (d.proposalId ? [d.proposalId] : [])));
    const walked: Draft[] = fromWalk
      .filter((p) => !have.has(p.id))
      .map((p) => ({
        key: nextKey.current++,
        landmark: p.keptName,
        text: suggestedText(p.keptName),
        location: p.location,
        proposalId: p.id,
        photoUrl: p.photoUrl,
        alt: scriptNames([p.nameHi ?? "", p.nameKn ?? ""]),
      }));
    // The door stays last: new walk landmarks go before an existing landmark that is the door itself.
    const last = existing[existing.length - 1];
    const lastIsDoor = last !== undefined && metresBetween(last.location, door) <= DOOR_SAME_AS_LANDMARK_M;
    const merged = lastIsDoor ? [...existing.slice(0, -1), ...walked, last] : [...existing, ...walked];
    return merged.slice(0, MAX_LANDMARKS);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const crosshair = (): LatLon | null => {
    const c = map.current?.getCenter();
    return c ? { lat: c.lat, lon: c.lng } : null;
  };

  function add() {
    const location = crosshair();
    if (!location || drafts.length >= MAX_LANDMARKS) return;
    setDrafts((d) => [...d, { key: nextKey.current++, landmark: "", text: "", location, proposalId: null, photoUrl: null, alt: [] }]);
  }

  const update = (key: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function move(index: number, by: -1 | 1) {
    setDrafts((d) => {
      const next = [...d];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  function moveToCrosshair(key: number) {
    const location = crosshair();
    if (location) update(key, { location });
  }

  const complete = drafts.length > 0 && drafts.every((d) => d.landmark.trim() && d.text.trim());

  async function save() {
    if (!complete) return;
    setSaving(true);
    setError(null);
    try {
      const cues: CueInput[] = drafts.map((d) => ({
        landmark: d.landmark.trim(),
        text: d.text.trim(),
        location: d.location,
        ...(d.proposalId ? { proposalId: d.proposalId } : {}),
      }));
      const res = await api<{ warnings: string[] }>("/me/home", { method: "PUT", body: { handoffPoint: door, cues } });
      // Saved either way; if some names couldn't be added, say so before leaving.
      if (res.warnings.length > 0) {
        setWarnings(res.warnings);
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      console.error("[api] PUT /me/home failed", err);
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <main className="setup">
      <div className="setup-map">
        <Map center={door} zoom={17} className="fill" label="Move the map so the blue cross sits on a landmark, then add it">
          <MapHandle
            onMap={(m) => {
              map.current = m;
              setMapReady(true);
            }}
          />
          <MapMarker at={door} anchor="bottom" offset={[0, 14]}>
            <div className="door">
              <small>door</small>×
            </div>
          </MapMarker>
          {drafts.map((d, i) => (
            <MapMarker key={d.key} at={d.location} anchor={i % 2 ? "left" : "right"} offset={[i % 2 ? 10 : -10, 0]}>
              <Stamp stop={{ name: d.landmark.trim() || "Unnamed", location: d.location, photoUrl: d.photoUrl, alt: d.alt }} index={i} draft={!d.landmark.trim()} />
            </MapMarker>
          ))}
        </Map>
        <div className="crosshair crosshair-blue" aria-hidden="true">+</div>
        <div className="poster">
          <div className="street">What does a rider pass?</div>
          <div className="label">Put the blue + on a landmark and add it, in the order a rider meets them.</div>
        </div>
      </div>

      <aside className="setup-panel">
        <div className="topbar">
          <button className="btn ghost icon compact" type="button" onClick={onBack} aria-label="Back to your gate" style={{ width: 40 }}>
            <ArrowLeft size={18} />
          </button>
          {progress}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="title">Landmarks on the way</h1>
          <p className="muted">
            Start from the main road. Name each place the way a rider would say it, then write what Locus should tell them
            there. The last one can be your gate.
          </p>
        </div>

        <button className="btn block" type="button" onClick={add} disabled={!mapReady || drafts.length >= MAX_LANDMARKS}>
          <Plus size={18} />
          {drafts.length >= MAX_LANDMARKS ? `That's the limit of ${MAX_LANDMARKS}` : "Add landmark at the +"}
        </button>

        {drafts.length === 0 && (
          <div className="alert info">
            <MapPin size={20} />
            <span>No landmarks yet. Two to five usually does it: a petrol bunk, a temple, a bakery, your gate.</span>
          </div>
        )}

        <ol className="landmarks">
          {drafts.map((d, i) => (
            <li key={d.key} className="landmark">
              <div className="landmark-head">
                <span className="label">Stop {i + 1}{d.proposalId ? " · from your walk" : ""}</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn ghost icon compact" type="button" onClick={() => moveToCrosshair(d.key)} aria-label={`Move stop ${i + 1} to the +`} title="Move to the +" style={{ width: 40 }}>
                    <MapPin size={18} />
                  </button>
                  {i > 0 && (
                    <button className="btn ghost icon compact" type="button" onClick={() => move(i, -1)} aria-label={`Move stop ${i + 1} earlier`} style={{ width: 40 }}>
                      <ArrowUp size={18} />
                    </button>
                  )}
                  {i < drafts.length - 1 && (
                    <button className="btn ghost icon compact" type="button" onClick={() => move(i, 1)} aria-label={`Move stop ${i + 1} later`} style={{ width: 40 }}>
                      <ArrowDown size={18} />
                    </button>
                  )}
                  <button
                    className="btn ghost icon compact"
                    type="button"
                    onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                    aria-label={`Remove stop ${i + 1}`}
                    style={{ width: 40 }}
                  >
                    <Trash size={18} />
                  </button>
                </div>
              </div>
              <label className="field">
                <span>What a rider would call it</span>
                <input value={d.landmark} onChange={(e) => update(d.key, { landmark: e.target.value })} placeholder="Hanuman temple" maxLength={60} />
              </label>
              <label className="field">
                <span>What Locus says there</span>
                <textarea
                  value={d.text}
                  onChange={(e) => update(d.key, { text: e.target.value })}
                  placeholder="Mandir aapke right mein aayega, uske peeche wali gali mein aaiye."
                  maxLength={200}
                />
              </label>
            </li>
          ))}
        </ol>

        {error && (
          <div className="alert err" role="alert">
            <span>Couldn&rsquo;t save your route: {error}</span>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="alert warn" role="status">
            <MapPin size={20} />
            <div className="stack" style={{ gap: 8 }}>
              <span>Your route is saved.</span>
              {warnings.map((w) => (
                <span key={w} className="small">{w}</span>
              ))}
              <button className="btn compact" type="button" onClick={onDone}>
                Go to home
              </button>
            </div>
          </div>
        )}
        <button className="btn primary block" type="button" onClick={() => void save()} disabled={!complete || saving}>
          {saving ? "Saving…" : "Save route"}
        </button>
        {!complete && drafts.length > 0 && <p className="label">Every stop needs a name and what Locus says.</p>}
      </aside>
    </main>
  );
}
