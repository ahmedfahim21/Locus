"use client";

import { ArrowLeft, ArrowRight, Check, MapPin, Record, Stop, VideoCamera, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, scriptNames, supabase, type LatLon, type Proposal, type Walk } from "../../lib/api";
import { MAX_RECORD_S, useWalkRecorder, type Recording } from "../../lib/useWalkRecorder";
import { FitTo, Map, MapMarker } from "../mapcn/Map";
import { Stamp } from "../RouteMap";

const BUCKET = "locus-walks";
const POLL_MS = 2000;

/** A proposal the recipient kept, possibly renamed. Becomes a landmark draft. */
export type KeptProposal = Proposal & { keptName: string };

type Phase =
  | { kind: "intro" }
  | { kind: "record" }
  | { kind: "upload"; recording: Recording }
  | { kind: "process"; walkId: string }
  | { kind: "review"; walkId: string; proposals: Proposal[] }
  | { kind: "failed"; message: string; retryWalkId: string | null };

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The walk being processed or reviewed lives in the URL, so a reload picks it back up. */
function walkInUrl(): string | null {
  return new URL(window.location.href).searchParams.get("walk");
}
function setWalkInUrl(walkId: string | null) {
  const url = new URL(window.location.href);
  if (walkId) url.searchParams.set("walk", walkId);
  else url.searchParams.delete("walk");
  window.history.replaceState(null, "", url);
}

export function WalkStep({
  door,
  progress,
  onBack,
  onSkip,
  onDone,
}: {
  door: LatLon;
  progress: ReactNode;
  onBack: () => void;
  onSkip: () => void;
  onDone: (kept: KeptProposal[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>(() => {
    const walkId = walkInUrl();
    return walkId ? { kind: "process", walkId } : { kind: "intro" };
  });

  useEffect(() => {
    setWalkInUrl(phase.kind === "process" || phase.kind === "review" ? phase.walkId : null);
  }, [phase]);
  const recorder = useWalkRecorder();
  const mounted = useRef(true);
  /** The recording already sent, so a re-run effect never uploads it twice. */
  const uploaded = useRef<Blob | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A finished recording goes straight to upload.
  useEffect(() => {
    if (recorder.state.phase === "done") setPhase({ kind: "upload", recording: recorder.state.recording });
    if (recorder.state.phase === "error") setPhase({ kind: "failed", message: recorder.state.message, retryWalkId: null });
  }, [recorder.state]);

  useEffect(() => {
    if (phase.kind !== "upload" || uploaded.current === phase.recording.blob) return;
    uploaded.current = phase.recording.blob;
    void (async () => {
      const { recording } = phase;
      try {
        if (recording.track.length < 2) {
          throw new ApiError(400, "NO_GPS", "Your phone didn't record any GPS during the walk. Turn on location and record again outdoors.");
        }
        const created = await api<{ walk: Walk; upload: { path: string; token: string } }>("/me/walks", {
          method: "POST",
          body: { contentType: recording.contentType, durationS: recording.durationS, sizeBytes: recording.blob.size, track: recording.track },
        });
        const { error } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(created.upload.path, created.upload.token, recording.blob, { contentType: recording.contentType });
        if (error) throw new Error(`Upload failed: ${error.message}`);
        await api(`/me/walks/${created.walk.id}/process`, { method: "POST" });
        if (mounted.current) setPhase({ kind: "process", walkId: created.walk.id });
      } catch (err) {
        console.error("[walk] upload failed", err);
        if (mounted.current) setPhase({ kind: "failed", message: (err as Error).message, retryWalkId: null });
      }
    })();
  }, [phase]);

  useEffect(() => {
    if (phase.kind !== "process") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await api<{ walk: Walk; proposals: Proposal[] }>(`/me/walks/${phase.walkId}`);
        if (stopped) return;
        if (res.walk.status === "ready") return setPhase({ kind: "review", walkId: phase.walkId, proposals: res.proposals });
        if (res.walk.status === "failed") {
          return setPhase({ kind: "failed", message: res.walk.error ?? "Processing failed", retryWalkId: phase.walkId });
        }
      } catch (err) {
        console.error("[walk] status check failed", err);
        if (!stopped) return setPhase({ kind: "failed", message: `Couldn't check on your walk: ${(err as Error).message}`, retryWalkId: null });
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase]);

  async function retry(walkId: string) {
    try {
      await api(`/me/walks/${walkId}/process`, { method: "POST" });
      setPhase({ kind: "process", walkId });
    } catch (err) {
      console.error("[walk] retry failed", err);
      setPhase({ kind: "failed", message: (err as Error).message, retryWalkId: null });
    }
  }

  function recordAgain() {
    recorder.reset();
    setPhase({ kind: "record" });
  }

  const rec = recorder.state;
  const recording = phase.kind === "record" && (rec.phase === "recording" || rec.phase === "starting");

  return (
    <main className="setup">
      <div className="setup-map">
        {phase.kind === "review" ? (
          <ReviewMap door={door} proposals={phase.proposals} />
        ) : (
          <div className="viewfinder">
            <video ref={recorder.preview} muted playsInline aria-label="Camera preview" />
            {!recording && (
              <div className="viewfinder-idle">
                <VideoCamera size={48} />
                <span>Your camera appears here</span>
              </div>
            )}
            {rec.phase === "recording" && (
              <>
                <div className="vf-top">
                  <span className="row" style={{ gap: 8 }}>
                    <span className="live-dot" />
                    <span className="mono">{clock(rec.elapsedS)}</span>
                    <span className="label" style={{ color: "inherit" }}>/ {clock(MAX_RECORD_S)}</span>
                  </span>
                  <span className="label" style={{ color: "inherit" }}>
                    <MapPin size={14} /> {rec.gpsError ?? (rec.accuracyM === null ? "Finding GPS…" : `GPS ±${Math.round(rec.accuracyM)} m · ${rec.fixes} fixes`)}
                  </span>
                </div>
                <div className="vf-tip">Point the camera at shop boards, temples and gates as you pass them.</div>
              </>
            )}
          </div>
        )}
        <div className="poster">
          <div className="street">{phase.kind === "review" ? "Is this right?" : "Walk it once."}</div>
          <div className="label">
            {phase.kind === "review" ? "Landmarks found in your video. Keep, rename or skip each one." : "From the main road to your gate, filming as you go."}
          </div>
        </div>
      </div>

      <aside className="setup-panel">
        <div className="topbar">
          <button className="btn ghost icon compact" type="button" onClick={onBack} disabled={recording} aria-label="Back to your gate" style={{ width: 40 }}>
            <ArrowLeft size={18} />
          </button>
          {progress}
        </div>

        {phase.kind === "intro" && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="title">Film the way in</h1>
              <p className="muted">
                Stand where a rider turns off the main road. Start recording, walk to your gate at a normal pace, and stop
                there. 30 to 90 seconds is plenty.
              </p>
            </div>
            <ul className="tips">
              <li>Hold the phone upright and point it ahead, at boards and gates.</li>
              <li>Keep location on: Locus places each landmark from your GPS.</li>
              <li>Faces and number plates are skipped, and the video is deleted once the landmarks are found.</li>
            </ul>
            <button className="btn primary block" type="button" onClick={() => setPhase({ kind: "record" })}>
              <VideoCamera size={18} />
              I&rsquo;m at the main road
            </button>
            <button className="btn ghost block" type="button" onClick={onSkip}>
              Skip, I&rsquo;ll add landmarks myself
            </button>
          </>
        )}

        {phase.kind === "record" && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="title">{rec.phase === "recording" ? "Recording" : "Ready when you are"}</h1>
              <p className="muted">
                {rec.phase === "recording"
                  ? "Walk to your gate, then stop."
                  : "Your browser will ask for the camera and your location. Allow both."}
              </p>
            </div>
            {rec.phase === "recording" && rec.gpsError === "Location permission is off" && (
              <div className="alert warn" role="alert">
                <Warning size={20} />
                <span>Location is off, so the walk can&rsquo;t be used. Allow location for this site and record again.</span>
              </div>
            )}
            {rec.phase === "recording" ? (
              <button className="btn primary block" type="button" onClick={recorder.stop} disabled={rec.elapsedS < 3}>
                <Stop size={18} />
                I&rsquo;m at my gate
              </button>
            ) : (
              <button className="btn primary block" type="button" onClick={() => void recorder.start()} disabled={rec.phase === "starting"}>
                <Record size={18} />
                {rec.phase === "starting" ? "Opening the camera…" : "Start recording"}
              </button>
            )}
          </>
        )}

        {phase.kind === "upload" && (
          <Waiting title="Uploading your walk" body={`${mb(phase.recording.blob.size)}, ${Math.round(phase.recording.durationS)} s, ${phase.recording.track.length} GPS fixes.`} />
        )}
        {phase.kind === "process" && (
          <Waiting title="Finding landmarks" body="Reading shop boards and gates frame by frame. Usually under a minute; you can keep this screen open." />
        )}

        {phase.kind === "failed" && (
          <>
            <div className="alert err" role="alert">
              <Warning size={20} />
              <span>{phase.message}</span>
            </div>
            {phase.retryWalkId && (
              <button className="btn primary block" type="button" onClick={() => void retry(phase.retryWalkId!)}>
                Try again
              </button>
            )}
            <button className={`btn block${phase.retryWalkId ? "" : " primary"}`} type="button" onClick={recordAgain}>
              <VideoCamera size={18} />
              Record again
            </button>
            <button className="btn ghost block" type="button" onClick={onSkip}>
              Skip, I&rsquo;ll add landmarks myself
            </button>
          </>
        )}

        {phase.kind === "review" && <Review proposals={phase.proposals} onDone={onDone} onRecordAgain={recordAgain} />}
      </aside>
    </main>
  );
}

function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <div className="stack" style={{ gap: 10 }} aria-busy="true" role="status">
      <h1 className="title">{title}</h1>
      <p className="muted">{body}</p>
      <div className="skeleton" style={{ height: 8 }} />
    </div>
  );
}

function ReviewMap({ door, proposals }: { door: LatLon; proposals: Proposal[] }) {
  const center = proposals[0]?.location ?? door;
  return (
    <Map center={center} zoom={17} className="fill" label="Landmarks found in your walk">
      <FitTo points={[door, ...proposals.map((p) => p.location)]} padding={{ top: 140, bottom: 60, left: 150, right: 150 }} />
      <MapMarker at={door} anchor="bottom" offset={[0, 14]}>
        <div className="door">
          <small>door</small>×
        </div>
      </MapMarker>
      {proposals.map((p, i) => (
        <MapMarker key={p.id} at={p.location} anchor={i % 2 ? "left" : "right"} offset={[i % 2 ? 10 : -10, 0]}>
          {/* Photos are in the list beside the map; the map keeps the stamps small. */}
          <Stamp stop={{ name: p.name, location: p.location, alt: scriptNames([p.nameHi ?? "", p.nameKn ?? ""]) }} index={i} />
        </MapMarker>
      ))}
    </Map>
  );
}

function Review({ proposals, onDone, onRecordAgain }: { proposals: Proposal[]; onDone: (kept: KeptProposal[]) => void; onRecordAgain: () => void }) {
  const [keep, setKeep] = useState(() => new Set(proposals.map((p) => p.id)));
  const [names, setNames] = useState(() => Object.fromEntries(proposals.map((p) => [p.id, p.name])));

  if (proposals.length === 0) {
    return (
      <>
        <div className="alert info">
          <MapPin size={20} />
          <span>No landmarks stood out in this video. Try again pointing at boards and gates, or add them yourself.</span>
        </div>
        <button className="btn primary block" type="button" onClick={onRecordAgain}>
          <VideoCamera size={18} />
          Record again
        </button>
        <button className="btn ghost block" type="button" onClick={() => onDone([])}>
          Add landmarks myself
        </button>
      </>
    );
  }

  const kept = proposals.filter((p) => keep.has(p.id) && names[p.id]!.trim());
  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">Found {proposals.length} landmark{proposals.length === 1 ? "" : "s"}</h1>
        <p className="muted">Keep the ones a rider would notice. Rename any the way a rider would say it.</p>
      </div>
      <ol className="landmarks">
        {proposals.map((p) => {
          const on = keep.has(p.id);
          return (
            <li key={p.id} className={`landmark proposal${on ? "" : " skipped"}`}>
              <div className="proposal-row">
                <Stamp stop={{ name: names[p.id] || p.name, location: p.location, photoUrl: p.photoUrl }} index={p.ordinal - 1} draft={!on} />
                <div className="stack" style={{ gap: 6 }}>
                  <label className="field">
                    <span>What a rider would call it</span>
                    <input value={names[p.id]} onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))} maxLength={60} disabled={!on} />
                  </label>
                  {(p.nameHi || p.nameKn) && (
                    <span className="label">
                      {p.nameHi && <span className="deva">{p.nameHi}</span>}
                      {p.nameHi && p.nameKn && " · "}
                      {p.nameKn && <span className="knda">{p.nameKn}</span>}
                    </span>
                  )}
                  {p.osmId && <span className="label">Matched to a place on the map</span>}
                </div>
              </div>
              <div className="row">
                <button type="button" className="chip" aria-pressed={on} onClick={() => setKeep((k) => new Set(on ? [...k].filter((x) => x !== p.id) : [...k, p.id]))}>
                  {on ? <Check size={16} /> : null}
                  {on ? "Keeping" : "Skipped"}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button className="btn primary block" type="button" onClick={() => onDone(kept.map((p) => ({ ...p, keptName: names[p.id]!.trim() })))} disabled={kept.length === 0}>
        Use {kept.length} landmark{kept.length === 1 ? "" : "s"}
        <ArrowRight size={18} />
      </button>
      <button className="btn ghost block" type="button" onClick={onRecordAgain}>
        Record again
      </button>
    </>
  );
}
