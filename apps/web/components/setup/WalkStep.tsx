"use client";

import { AccountMenu } from "../AccountMenu";
import { ArrowLeft, ArrowRight, Check, DeviceMobile, Images, MapPin, Plus, Record, ShieldCheck, Stop, VideoCamera, Warning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, apiForm, scriptNames, scriptOf, supabase, type LatLon, type Proposal, type Walk } from "../../lib/api";
import { MAX_PHOTOS, toJpeg } from "../../lib/photos";
import { MAX_RECORD_S, useWalkRecorder, type Recording } from "../../lib/useWalkRecorder";
import { FitTo, Map, MapMarker } from "../mapcn/Map";
import { DoorPin, Stamp, StampPhoto } from "../RouteMap";
import { AnalysingStage, AnalysingSteps, videoThumbs } from "./Analysing";

const BUCKET = "locus-walks";
const POLL_MS = 2000;
/** Failed status checks in a row (about a minute with backoff) before giving up. */
const MAX_POLL_MISSES = 6;

/** A proposal the recipient kept, possibly renamed. Becomes a landmark draft. */
export type KeptProposal = Proposal & { keptName: string };

type Phase =
  | { kind: "intro" }
  | { kind: "record" }
  | { kind: "upload"; recording: Recording }
  | { kind: "photos"; files: File[] }
  | { kind: "sendPhotos"; files: File[] }
  | { kind: "process"; walkId: string; photos?: boolean }
  | { kind: "review"; walkId: string; proposals: Proposal[]; photos?: boolean }
  | { kind: "failed"; message: string; retryWalkId: string | null; photos?: boolean };

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
  /** Kept proposals (with any rename) and the ids the recipient skipped. */
  onDone: (kept: KeptProposal[], skipped: string[]) => void;
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
  /** Small frames of the recipient's own walk or photos, for the analysing screen. */
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The recording screen opens the camera and warms up GPS straight away.
  useEffect(() => {
    if (phase.kind === "record" && recorder.state.phase === "idle") void recorder.prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  // A finished recording goes straight to upload.
  useEffect(() => {
    if (recorder.state.phase === "done") setPhase({ kind: "upload", recording: recorder.state.recording });
    if (recorder.state.phase === "error") setPhase({ kind: "failed", message: recorder.state.message, retryWalkId: null });
  }, [recorder.state]);

  useEffect(() => {
    if (phase.kind !== "upload" || uploaded.current === phase.recording.blob) return;
    uploaded.current = phase.recording.blob;
    const { recording: rec0 } = phase;
    // Decoration only: without thumbnails the stage still shows its map.
    videoThumbs(rec0.blob, rec0.durationS)
      .then((t) => mounted.current && setThumbs(t))
      .catch((err) => console.error("[walk] couldn't read thumbnails from the recording", err));
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
    let misses = 0;
    const poll = async () => {
      try {
        const res = await api<{ walk: Walk; proposals: Proposal[] }>(`/me/walks/${phase.walkId}`);
        misses = 0;
        if (stopped) return;
        if (res.walk.status === "ready") return setPhase({ kind: "review", walkId: phase.walkId, proposals: res.proposals, photos: phase.photos });
        if (res.walk.status === "failed") {
          // Photos aren't kept after a failed try, so there's nothing to retry server-side.
          return setPhase({ kind: "failed", message: res.walk.error ?? "Processing failed", retryWalkId: phase.photos ? null : phase.walkId, photos: phase.photos });
        }
      } catch (err) {
        // A walk is read on the server either way: ride out a weak connection, keep checking.
        misses++;
        console.warn("[walk] status check failed; retrying", { misses, err });
        if (misses >= MAX_POLL_MISSES) {
          console.error("[walk] status check kept failing", err);
          if (!stopped) setPhase({ kind: "failed", message: `Couldn't reach Locus to check on your walk: ${(err as Error).message}`, retryWalkId: null });
          return;
        }
        if (!stopped) timer = setTimeout(poll, POLL_MS * 2 ** Math.min(misses, 3));
        return;
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase]);

  // Photos: shrink each to JPEG in the browser, send them with the gate's position, then follow processing.
  useEffect(() => {
    if (phase.kind !== "sendPhotos") return;
    let cancelled = false;
    setThumbs(phase.files.map((f) => URL.createObjectURL(f)));
    void (async () => {
      try {
        const form = new FormData();
        form.set("lat", String(door.lat));
        form.set("lon", String(door.lon));
        for (const [i, f] of phase.files.entries()) form.append("photo", await toJpeg(f), `photo-${i + 1}.jpg`);
        const res = await apiForm<{ walk: Walk }>("/me/photos", form);
        if (!cancelled) setPhase({ kind: "process", walkId: res.walk.id, photos: true });
      } catch (err) {
        console.error("[photos] upload failed", err);
        if (!cancelled) setPhase({ kind: "failed", message: (err as Error).message, retryWalkId: null, photos: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, door.lat, door.lon]);

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
  const cameraOn = phase.kind === "record" && (rec.phase === "ready" || rec.phase === "recording");

  return (
    <main className="setup">
      <div className="setup-map">
        {phase.kind === "review" ? (
          <ReviewMap door={door} proposals={phase.proposals} />
        ) : phase.kind === "upload" || phase.kind === "sendPhotos" || phase.kind === "process" ? (
          <AnalysingStage thumbs={thumbs} photos={phase.kind === "sendPhotos" || (phase.kind === "process" && Boolean(phase.photos))} />
        ) : phase.kind === "photos" ? (
          <PhotoGrid files={phase.files} />
        ) : (
          <div className="viewfinder">
            <video ref={recorder.preview} muted playsInline aria-label="Camera preview" />
            {!cameraOn && (
              <div className="viewfinder-idle">
                <VideoCamera size={48} />
                <span>Your camera appears here</span>
              </div>
            )}
            {rec.phase === "ready" && (
              <div className="vf-top">
                <span className="vf-pill">
                  <MapPin size={14} /> {rec.gpsError ?? (rec.accuracyM === null ? "Finding GPS…" : `GPS ready ±${Math.round(rec.accuracyM)} m`)}
                </span>
              </div>
            )}
            {rec.phase === "recording" && (
              <>
                <div className="vf-top">
                  <span className="vf-pill">
                    <span className="live-dot" />
                    <span className="mono">{clock(rec.elapsedS)}</span>
                    <span style={{ opacity: 0.6 }}>/ {clock(MAX_RECORD_S)}</span>
                  </span>
                  <span className="vf-pill">
                    <MapPin size={14} /> {rec.gpsError ?? (rec.accuracyM === null ? "Finding GPS…" : `±${Math.round(rec.accuracyM)} m`)}
                  </span>
                </div>
                <div className="vf-tip">Point the camera at shop boards, temples and gates as you pass them.</div>
              </>
            )}
          </div>
        )}
        <div className="poster glass">
          <div className="street">
            {phase.kind === "review"
              ? "Is this right?"
              : phase.kind === "upload" || phase.kind === "sendPhotos" || phase.kind === "process"
                ? "Reading your way in."
                : phase.kind === "photos"
                  ? "Your photos"
                  : "Walk it once."}
          </div>
          <div className="label">
            {phase.kind === "review"
              ? "Landmarks Locus found. Keep, rename or skip each one."
              : phase.kind === "upload" || phase.kind === "sendPhotos" || phase.kind === "process"
                ? "Looking for what a rider will see on the way to your gate."
                : phase.kind === "photos"
                ? "Shop boards, gates, temples: anything a rider passes on the way in."
                : "From the main road to your gate, filming as you go."}
          </div>
        </div>
      </div>

      <aside className="setup-panel">
        <div className="topbar">
          <button className="btn icon" type="button" onClick={onBack} disabled={recording} aria-label="Back to your gate">
            <ArrowLeft size={18} />
          </button>
          <div className="row" style={{ gap: 12 }}>
            {progress}
            <AccountMenu />
          </div>
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
            <ul className="group tips">
              {[
                [DeviceMobile, "Hold the phone upright and point it at boards and gates."],
                [MapPin, "Keep location on: each landmark is placed from your GPS."],
                [ShieldCheck, "Used only to find landmarks. The video and your GPS trail are deleted as soon as they're read; Locus keeps a small crop of each landmark you keep."],
              ].map(([Icon, text]) => {
                const I = Icon as typeof MapPin;
                return (
                  <li key={text as string}>
                    <div className="cell">
                      <span className="cell-icon"><I size={17} /></span>
                      <span className="cell-main small">{text as string}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button className="btn primary block" type="button" onClick={() => setPhase({ kind: "record" })}>
              <VideoCamera size={18} />
              I&rsquo;m at the main road
            </button>
            <button className="btn block" type="button" onClick={() => setPhase({ kind: "photos", files: [] })}>
              <Images size={18} />
              No time to walk? Add photos
            </button>
            <button className="btn ghost block" type="button" onClick={onSkip}>
              Skip, I&rsquo;ll add landmarks myself
            </button>
          </>
        )}

        {phase.kind === "photos" && (
          <PhotoPicker
            files={phase.files}
            onChange={(files) => setPhase({ kind: "photos", files })}
            onSend={() => setPhase({ kind: "sendPhotos", files: phase.files })}
            onCancel={() => setPhase({ kind: "intro" })}
          />
        )}
        {phase.kind === "sendPhotos" && (
          <AnalysingSteps uploading photos detail={`${phase.files.length} photo${phase.files.length === 1 ? "" : "s"}, shrunk to save data.`} />
        )}

        {phase.kind === "record" && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="title">{rec.phase === "recording" ? "Recording" : rec.phase === "ready" && rec.accuracyM !== null ? "Ready when you are" : "Getting ready"}</h1>
              <p className="muted">
                {rec.phase === "recording"
                  ? "Walk to your gate, then stop. Keep Locus open; the screen stays on."
                  : rec.phase === "ready"
                    ? rec.accuracyM === null
                      ? "Finding your position. Stand in the open for a few seconds."
                      : "Stand where a rider turns off the main road, then start."
                    : "Your browser will ask for the camera and your location. Allow both."}
              </p>
            </div>
            {(rec.phase === "recording" || rec.phase === "ready") && rec.gpsError === "Location permission is off" && (
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
              <button
                className="btn primary block"
                type="button"
                onClick={() => void (rec.phase === "ready" ? recorder.start() : recorder.prepare())}
                disabled={rec.phase === "starting" || (rec.phase === "ready" && rec.accuracyM === null)}
              >
                <Record size={18} />
                {rec.phase === "starting"
                  ? "Opening the camera…"
                  : rec.phase === "ready"
                    ? rec.accuracyM === null
                      ? "Waiting for GPS…"
                      : "Start recording"
                    : "Open the camera"}
              </button>
            )}
          </>
        )}

        {phase.kind === "upload" && (
          <AnalysingSteps uploading photos={false} detail={`${mb(phase.recording.blob.size)}, ${Math.round(phase.recording.durationS)} s, ${phase.recording.track.length} GPS fixes.`} />
        )}
        {phase.kind === "process" && (
          <AnalysingSteps uploading={false} photos={Boolean(phase.photos)} detail="Usually under a minute. You can keep this screen open or come back to it." />
        )}

        {phase.kind === "failed" && phase.photos && (
          <>
            <div className="alert err" role="alert">
              <Warning size={20} />
              <span>{phase.message}</span>
            </div>
            <button className="btn primary block" type="button" onClick={() => setPhase({ kind: "photos", files: [] })}>
              <Images size={18} />
              Choose photos again
            </button>
            <button className="btn ghost block" type="button" onClick={onSkip}>
              Skip, I&rsquo;ll add landmarks myself
            </button>
          </>
        )}
        {phase.kind === "failed" && !phase.photos && (
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

        {phase.kind === "review" && (
          <Review
            proposals={phase.proposals}
            fromPhotos={Boolean(phase.photos)}
            onDone={onDone}
            onRecordAgain={phase.photos ? () => setPhase({ kind: "photos", files: [] }) : recordAgain}
          />
        )}
      </aside>
    </main>
  );
}

function ReviewMap({ door, proposals }: { door: LatLon; proposals: Proposal[] }) {
  const center = proposals[0]?.location ?? door;
  return (
    <Map center={center} zoom={17} className="fill" label="Landmarks found in your walk">
      <FitTo points={[door, ...proposals.map((p) => p.location)]} padding={{ top: 140, bottom: 60, left: 150, right: 150 }} />
      <MapMarker at={door} anchor="bottom" offset={[0, 9]}>
        <DoorPin label="Door" />
      </MapMarker>
      {proposals.map((p, i) => (
        <MapMarker key={p.id} at={p.location} anchor="left" offset={[-14, 0]}>
          {/* Photos are in the list beside the map; the map keeps the stamps small. */}
          <Stamp stop={{ name: p.name, location: p.location, alt: scriptNames([p.nameHi ?? "", p.nameLocal ?? ""]) }} index={i} />
        </MapMarker>
      ))}
    </Map>
  );
}

function Review({
  proposals,
  fromPhotos,
  onDone,
  onRecordAgain,
}: {
  proposals: Proposal[];
  fromPhotos: boolean;
  onDone: (kept: KeptProposal[], skipped: string[]) => void;
  onRecordAgain: () => void;
}) {
  const [keep, setKeep] = useState(() => new Set(proposals.map((p) => p.id)));
  const [names, setNames] = useState(() => Object.fromEntries(proposals.map((p) => [p.id, p.name])));

  if (proposals.length === 0) {
    return (
      <>
        <div className="alert info">
          <MapPin size={20} />
          <span>
            {fromPhotos
              ? "No landmarks stood out in these photos. Try closer shots of boards and gates, or add them yourself."
              : "No landmarks stood out in this video. Try again pointing at boards and gates, or add them yourself."}
          </span>
        </div>
        <button className="btn primary block" type="button" onClick={onRecordAgain}>
          {fromPhotos ? <Images size={18} /> : <VideoCamera size={18} />}
          {fromPhotos ? "Choose other photos" : "Record again"}
        </button>
        <button className="btn ghost block" type="button" onClick={() => onDone([], [])}>
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
                <span className="proposal-photo">
                  {p.photoUrl ? <StampPhoto url={p.photoUrl} alt={p.name} /> : null}
                </span>
                <div className="stack" style={{ gap: 6 }}>
                  <label className="field">
                    <span>What a rider would call it</span>
                    <input value={names[p.id]} onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))} maxLength={60} disabled={!on} />
                  </label>
                  {p.detail && <span className="muted small">&ldquo;{p.detail}&rdquo;</span>}
                  {(p.nameHi || p.nameLocal) && (
                    <span className="label">
                      {p.nameHi && <span className="deva">{p.nameHi}</span>}
                      {p.nameHi && p.nameLocal && " · "}
                      {p.nameLocal && <span className={scriptOf(p.nameLocal) ?? undefined}>{p.nameLocal}</span>}
                    </span>
                  )}
                  {p.osmId ? (
                    <span className="label">Matched to a place on the map</span>
                  ) : fromPhotos ? (
                    <span className="label">Not on the map yet: it starts at your gate, move it to the right spot next.</span>
                  ) : null}
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
      <button className="btn primary block" type="button" onClick={() => onDone(kept.map((p) => ({ ...p, keptName: names[p.id]!.trim() })), proposals.filter((p) => !kept.includes(p)).map((p) => p.id))} disabled={kept.length === 0}>
        Use {kept.length} landmark{kept.length === 1 ? "" : "s"}
        <ArrowRight size={18} />
      </button>
      <button className="btn ghost block" type="button" onClick={onRecordAgain}>
        Record again
      </button>
    </>
  );
}

function PhotoPicker({
  files,
  onChange,
  onSend,
  onCancel,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    onChange([...files, ...[...list].filter((f) => f.type.startsWith("image/"))].slice(0, MAX_PHOTOS));
    if (input.current) input.current.value = "";
  };
  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">Add photos</h1>
        <p className="muted">
          Up to {MAX_PHOTOS} photos of what a rider sees on the way in: phone photos, or screenshots of your street. Locus reads the
          boards and gates in them, keeps a small crop of each landmark, and discards the rest.
        </p>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      <button className="btn block" type="button" onClick={() => input.current?.click()} disabled={files.length >= MAX_PHOTOS}>
        <Plus size={18} />
        {files.length ? `Add more (${files.length} of ${MAX_PHOTOS})` : "Choose photos"}
      </button>
      {files.length > 0 && (
        <ul className="photo-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="small">{f.name}</span>
              <button type="button" className="btn ghost icon" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn primary block" type="button" onClick={onSend} disabled={files.length === 0}>
        Find landmarks
        <ArrowRight size={18} />
      </button>
      <button className="btn ghost block" type="button" onClick={onCancel}>
        Back
      </button>
    </>
  );
}

/** The chosen photos, large, on the map side while choosing and uploading. */
function PhotoGrid({ files }: { files: File[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="viewfinder photo-grid">
      {urls.length === 0 ? (
        <div className="viewfinder-idle">
          <Images size={48} />
          <span>Your photos appear here</span>
        </div>
      ) : (
        urls.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- local previews
          <img key={u} src={u} alt={`Photo ${i + 1}`} />
        ))
      )}
    </div>
  );
}
