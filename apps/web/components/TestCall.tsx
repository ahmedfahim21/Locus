"use client";

import { Microphone, MicrophoneSlash, Phone, PhoneDisconnect, Warning } from "@phosphor-icons/react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Call } from "../lib/api";
import { CallView } from "./CallView";

type Ticket = { url: string; token: string; room: string };
type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; since: number }
  | { kind: "ended" }
  | { kind: "error"; message: string; code: string | null };

/**
 * A browser call to the recipient's own Locus: you play the rider with your mic,
 * the worker answers exactly as on a phone call, and the call view follows along.
 */
export function TestCall() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<"locus" | "you" | null>(null);
  const room = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);

  const hangUp = useCallback(async () => {
    const r = room.current;
    room.current = null;
    await r?.disconnect();
    setSpeaking(null);
    setPhase((p) => (p.kind === "live" || p.kind === "starting" ? { kind: "ended" } : p));
  }, []);

  useEffect(() => () => void room.current?.disconnect(), []);

  async function start(turnOnFirst = false) {
    setPhase({ kind: "starting" });
    setMuted(false);
    try {
      if (turnOnFirst) await api("/me/expecting", { method: "PUT", body: { on: true } });
      const ticket = await api<Ticket>("/me/test-call", { method: "POST" });
      const r = new Room({ adaptiveStream: false, dynacast: false });
      room.current = r;
      r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        audio.current?.appendChild(el);
      });
      r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()));
      r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const local = speakers.some((s) => s.isLocal);
        const remote = speakers.some((s) => !s.isLocal);
        setSpeaking(remote ? "locus" : local ? "you" : null);
      });
      // Locus hangs up when the rider arrives or the call ends.
      r.on(RoomEvent.Disconnected, () => {
        room.current = null;
        setSpeaking(null);
        setPhase((p) => (p.kind === "live" ? { kind: "ended" } : p));
      });
      await r.connect(ticket.url, ticket.token);
      await r.localParticipant.setMicrophoneEnabled(true);
      setPhase({ kind: "live", since: Date.now() });
    } catch (err) {
      console.error("[test-call] failed to start", err);
      await room.current?.disconnect();
      room.current = null;
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setPhase({
        kind: "error",
        code: err instanceof ApiError ? err.code : null,
        message: denied ? "Microphone permission is off. Allow it for this site and try again." : (err as Error).message,
      });
    }
  }

  async function toggleMute() {
    const r = room.current;
    if (!r) return;
    await r.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  // Follow the session this test started (the newest one created after we connected).
  const since = phase.kind === "live" ? phase.since - 10_000 : null;
  const pick = useCallback(
    (calls: Call[]) => (since === null ? undefined : calls.find((c) => new Date(c.createdAt).getTime() >= since)),
    [since],
  );

  const controls = (
    <div className="stack" style={{ gap: 10 }}>
      {phase.kind === "live" && (
        <>
          <div className="label row" style={{ gap: 6, minHeight: 20 }}>
            {speaking === "locus" && (
              <>
                <span className="wave" style={{ color: "var(--route)" }} aria-hidden="true"><i /><i /><i /><i /></span>
                Locus is speaking
              </>
            )}
            {speaking === "you" && (
              <>
                <span className="wave" style={{ color: "var(--live)" }} aria-hidden="true"><i /><i /><i /><i /></span>
                Hearing you
              </>
            )}
            {speaking === null && (muted ? "You're muted" : "Listening")}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" type="button" onClick={() => void toggleMute()} aria-pressed={muted} style={{ flex: 1 }}>
              {muted ? <MicrophoneSlash size={18} /> : <Microphone size={18} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="btn danger" type="button" onClick={() => void hangUp()} style={{ flex: 1 }}>
              <PhoneDisconnect size={18} />
              End
            </button>
          </div>
        </>
      )}
      {(phase.kind === "idle" || phase.kind === "ended" || phase.kind === "starting") && (
        <>
          <p className="small muted">
            {phase.kind === "ended"
              ? "Call ended. Start another to try different phrases."
              : "You play the rider. Say who the order is for and from which app, then name what you can see."}
          </p>
          <button className="btn primary block" type="button" onClick={() => void start()} disabled={phase.kind === "starting"}>
            <Phone size={18} />
            {phase.kind === "starting" ? "Connecting…" : phase.kind === "ended" ? "Call again" : "Start call"}
          </button>
        </>
      )}
      {phase.kind === "error" && (
        <>
          <div className="alert err" role="alert">
            <Warning size={18} />
            <span>{phase.message}</span>
          </div>
          {phase.code === "DELIVERY_NOT_EXPECTED" ? (
            <button className="btn primary block" type="button" onClick={() => void start(true)}>
              Turn it on and call
            </button>
          ) : (
            <button className="btn block" type="button" onClick={() => void start()}>
              Try again
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Outside CallView so Locus's audio element survives the switch from "connecting" to the live call. */}
      <div ref={audio} hidden />
      <CallView pick={pick} controls={controls} waiting={phase.kind === "live" ? "Locus is picking up…" : "Ready when you are"} />
    </>
  );
}
