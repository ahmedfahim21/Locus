"use client";

import { ChatText, Microphone, MicrophoneSlash, PaperPlaneRight, Phone, PhoneDisconnect, PhoneOutgoing, Warning } from "@phosphor-icons/react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Call, type Me } from "../lib/api";
import { CallView } from "./CallView";

type Ticket = { url: string; token: string; room: string };
type TypedReply = { sessionId: string; state: string; instruction: string | null };
/** States where a typed call has nothing more to say: arrived, ended, or Locus would now ring you. */
const TYPED_DONE = new Set(["arrived", "ended", "handoff"]);
type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; since: number }
  | { kind: "ringing"; since: number; phone: string; own: boolean }
  | { kind: "typing"; sessionId: string; state: string; reply: string; sending: boolean }
  | { kind: "ended" }
  | { kind: "error"; message: string; code: string | null };

/**
 * A browser call to the recipient's own Locus: you play the rider with your mic,
 * the worker answers exactly as on a phone call, and the call view follows along.
 * A typed call does the same without a mic: you type the rider's lines and read Locus's replies.
 */
export function TestCall() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<"locus" | "you" | null>(null);
  const room = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);
  /** The profile phone, when this server can call riders; null hides "Call the rider". */
  const [ownPhone, setOwnPhone] = useState<string | null>(null);
  /** The rider's number; starts as your own, so you can play the rider. */
  const [riderPhone, setRiderPhone] = useState("");
  const riderPhoneOk = /^\+91\d{10}$/.test(riderPhone);
  /** Which way the last attempt went, so "Try again" repeats it. */
  const via = useRef<"browser" | "phone" | "typed">("browser");
  /** What the rider says next in a typed call. */
  const [line, setLine] = useState("");
  /** An example first line, with your name and app, for the typed call's input. */
  const [example, setExample] = useState("Fahim ke liye, Swiggy se");

  useEffect(() => {
    api<Me>("/me").then(
      (me) => {
        const phone = me.canCallRider && me.recipient ? me.recipient.phone : null;
        setOwnPhone(phone);
        setRiderPhone(phone ?? "");
        if (me.recipient) {
          const app = me.recipient.platforms[0] ?? "Swiggy";
          setExample(`${me.recipient.firstName} ke liye, ${app.charAt(0).toUpperCase()}${app.slice(1)} se`);
        }
      },
      (err) => console.error("[test-call] couldn't load /me for Call the rider", err),
    );
  }, []);

  const hangUp = useCallback(async () => {
    const r = room.current;
    room.current = null;
    await r?.disconnect();
    setSpeaking(null);
    setPhase((p) => (p.kind === "live" || p.kind === "starting" ? { kind: "ended" } : p));
  }, []);

  useEffect(() => () => void room.current?.disconnect(), []);

  async function start(turnOnFirst = false) {
    via.current = "browser";
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

  /** Locus phones the rider and guides them in, as when a rider calls the Locus number. */
  async function callRider(turnOnFirst = false) {
    via.current = "phone";
    setPhase({ kind: "starting" });
    try {
      if (turnOnFirst) await api("/me/expecting", { method: "PUT", body: { on: true } });
      const { phone } = await api<{ ringing: true; phone: string }>("/me/call-rider", { method: "POST", body: { phone: riderPhone } });
      setPhase({ kind: "ringing", since: Date.now(), phone, own: phone === ownPhone });
    } catch (err) {
      console.error("[test-call] failed to ring the phone", err);
      setPhase({ kind: "error", code: err instanceof ApiError ? err.code : null, message: (err as Error).message });
    }
  }

  /** A typed call: same screening and guide loop, with the rider's lines typed in. */
  async function startTyped(turnOnFirst = false) {
    via.current = "typed";
    setPhase({ kind: "starting" });
    setLine("");
    try {
      if (turnOnFirst) await api("/me/expecting", { method: "PUT", body: { on: true } });
      const r = await api<TypedReply>("/me/typed-calls", { method: "POST" });
      setPhase({ kind: "typing", sessionId: r.sessionId, state: r.state, reply: r.instruction ?? "", sending: false });
    } catch (err) {
      console.error("[test-call] failed to start a typed call", err);
      setPhase({ kind: "error", code: err instanceof ApiError ? err.code : null, message: (err as Error).message });
    }
  }

  async function sendLine() {
    if (phase.kind !== "typing" || phase.sending || !line.trim()) return;
    const { sessionId } = phase;
    setPhase({ ...phase, sending: true });
    try {
      const r = await api<TypedReply>(`/me/typed-calls/${sessionId}/lines`, { method: "POST", body: { text: line.trim() } });
      setLine("");
      setPhase({ kind: "typing", sessionId, state: r.state, reply: r.instruction ?? "", sending: false });
    } catch (err) {
      console.error("[test-call] typed line failed", err);
      setPhase({ kind: "error", code: err instanceof ApiError ? err.code : null, message: (err as Error).message });
    }
  }

  async function endTyped() {
    if (phase.kind !== "typing") return;
    try {
      await api<TypedReply>(`/me/typed-calls/${phase.sessionId}/end`, { method: "POST" });
      setPhase({ kind: "ended" });
    } catch (err) {
      console.error("[test-call] couldn't end the typed call", err);
      setPhase({ kind: "error", code: err instanceof ApiError ? err.code : null, message: (err as Error).message });
    }
  }

  async function toggleMute() {
    const r = room.current;
    if (!r) return;
    await r.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  // Follow the session this test started (the newest one created after we connected).
  const since = phase.kind === "live" || phase.kind === "ringing" ? phase.since - 10_000 : null;
  const typedId = phase.kind === "typing" ? phase.sessionId : null;
  const pick = useCallback(
    (calls: Call[]) =>
      typedId !== null
        ? calls.find((c) => c.id === typedId)
        : since === null
          ? undefined
          : calls.find((c) => new Date(c.createdAt).getTime() >= since),
    [since, typedId],
  );

  const retry = (turnOnFirst = false) =>
    via.current === "phone" ? callRider(turnOnFirst) : via.current === "typed" ? startTyped(turnOnFirst) : start(turnOnFirst);

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
      {phase.kind === "typing" && (
        <>
          <p className="small" aria-live="polite">
            <span className="muted">Locus: </span>
            {phase.reply}
          </p>
          {TYPED_DONE.has(phase.state) ? (
            <>
              <p className="small muted">
                {phase.state === "arrived"
                  ? "The rider reached your door."
                  : phase.state === "handoff"
                    ? "On a phone call, Locus would ring you now and connect the rider. Typed calls stop here."
                    : "Call ended."}
              </p>
              <button className="btn primary block" type="button" onClick={() => void startTyped()}>
                <ChatText size={18} />
                Type another call
              </button>
            </>
          ) : (
            <>
              <form
                className="row"
                style={{ gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendLine();
                }}
              >
                <label className="field" style={{ flex: 1 }}>
                  <span>What the rider says</span>
                  <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={example} maxLength={300} autoFocus aria-label="What the rider says" />
                </label>
                <button className="btn primary" type="submit" disabled={phase.sending || !line.trim()} style={{ alignSelf: "end" }}>
                  <PaperPlaneRight size={18} />
                  {phase.sending ? "Sending…" : "Send"}
                </button>
              </form>
              <button className="btn danger block" type="button" onClick={() => void endTyped()} disabled={phase.sending}>
                <PhoneDisconnect size={18} />
                End
              </button>
            </>
          )}
        </>
      )}
      {phase.kind === "ringing" && (
        <>
          <p className="small muted">
            Calling the rider on <span className="mono">{phase.phone}</span>.{" "}
            {phase.own ? "Pick up and play the rider; the call shows here as it happens." : "The call shows here as it happens."}
          </p>
          <button className="btn block" type="button" onClick={() => setPhase({ kind: "ended" })}>
            Done
          </button>
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
          <button className="btn block" type="button" onClick={() => void startTyped()} disabled={phase.kind === "starting"}>
            <ChatText size={18} />
            Type as the rider instead
          </button>
          {ownPhone && (
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <label className="field">
                <span>Or Locus calls the rider and guides them to your door. Leave your own number to play the rider.</span>
                <input
                  className="mono"
                  value={riderPhone}
                  onChange={(e) => setRiderPhone(e.target.value.replace(/[\s-]/g, ""))}
                  inputMode="tel"
                  placeholder="+919800000000"
                  aria-invalid={riderPhone.length > 3 && !riderPhoneOk}
                />
                {riderPhone.length > 3 && !riderPhoneOk && <span style={{ color: "var(--danger)" }}>Use the full number with +91, e.g. +919800000000</span>}
              </label>
              <button className="btn block" type="button" onClick={() => void callRider()} disabled={phase.kind === "starting" || !riderPhoneOk}>
                <PhoneOutgoing size={18} />
                Call the rider
              </button>
            </div>
          )}
        </>
      )}
      {phase.kind === "error" && (
        <>
          <div className="alert err" role="alert">
            <Warning size={18} />
            <span>{phase.message}</span>
          </div>
          {phase.code === "DELIVERY_NOT_EXPECTED" ? (
            <button className="btn primary block" type="button" onClick={() => void retry(true)}>
              Turn it on and call
            </button>
          ) : (
            <button className="btn block" type="button" onClick={() => void retry()}>
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
      <CallView
        pick={pick}
        controls={controls}
        waiting={
          phase.kind === "live"
            ? "Locus is picking up…"
            : phase.kind === "ringing"
              ? "Waiting for the rider to pick up…"
              : phase.kind === "typing"
                ? "Type what the rider says"
                : "Ready when you are"
        }
      />
    </>
  );
}
