"use client";

import { PhoneSlash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { LIVE_STATES, STATE_LABEL, type Call } from "../lib/api";
import { useMe, useRoute } from "../lib/hooks";
import { useCalls } from "./Calls";
import { LiveCall, type LiveTurn } from "./LiveCall";
import { TopBar } from "./TopBar";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** One call on the projector layout, live while the worker is still on the line. */
export function CallView({ id }: { id: string }) {
  const me = useMe();
  const route = useRoute(Boolean(me.data?.home), me.data?.home?.confirmedAt ?? "");
  const { calls, error } = useCalls();
  const call = calls?.find((c) => c.id === id) ?? null;
  const live = call ? LIVE_STATES.has(call.state) : false;
  const now = useNow(live);

  const loadError = me.error ?? error;
  if (loadError && (!me.data || !calls)) {
    return (
      <main className="page">
        <TopBar back={{ href: "/", label: "Back to home" }} />
        <div className="alert err" role="alert">
          <span>Couldn&rsquo;t load this call: {loadError}</span>
        </div>
      </main>
    );
  }
  if (!me.data || calls === null) {
    return (
      <main className="page" aria-busy="true">
        <TopBar back={{ href: "/", label: "Back to home" }} />
        <div className="skeleton" style={{ height: "70vh" }} />
      </main>
    );
  }
  if (!call || !me.data.home) {
    return (
      <main className="page">
        <TopBar back={{ href: "/", label: "Back to home" }} />
        <div className="alert info">
          <PhoneSlash size={20} />
          <span>This call isn&rsquo;t in your recent calls any more. Locus keeps your last ten.</span>
        </div>
      </main>
    );
  }

  const home = me.data.home;
  const stops = home.cues.map((c) => ({ name: c.landmark, location: c.location }));
  const arrived = call.state === "arrived";
  const reached = Math.min(call.reachedCue, stops.length);
  const next = stops[reached];
  const lastInstruction = call.turns[call.turns.length - 1]?.instruction ?? null;
  const started = new Date(call.createdAt).getTime();
  const ended = call.endedAt ? new Date(call.endedAt).getTime() : null;

  return (
    <main className="page">
      <TopBar back={{ href: "/", label: "Back to home" }}>
        <span className="label">{new Date(call.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
      </TopBar>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--kumkum)" }}>
          Couldn&rsquo;t refresh: {error}. Retrying.
        </p>
      )}
      <LiveCall
        stops={stops}
        door={home.handoffPoint}
        legs={route.data?.legs ?? null}
        reached={reached}
        arrived={arrived}
        live={live}
        timer={clock((ended ?? now) - started)}
        poster={arrived ? "At your door" : reached > 0 ? `At ${stops[reached - 1]!.name}` : "Finding the rider"}
        posterSub={
          <>
            DIGIPIN <span className="mono">{home.digipin}</span>
          </>
        }
        statusLabel={call.state === "guiding" ? "Guiding to" : "Status"}
        statusText={call.state === "guiding" ? (next?.name ?? "Your door") : (STATE_LABEL[call.state] ?? call.state)}
        turns={toTurns(call)}
        note={call.state === "guiding" && reached > 0 ? lastInstruction : null}
        footer={<CallFooter call={call} />}
      />
      {route.error && (
        <p className="small" role="alert" style={{ color: "var(--kumkum)" }}>
          Couldn&rsquo;t draw the route: {route.error}
        </p>
      )}
    </main>
  );
}

function toTurns(call: Call): LiveTurn[] {
  const out: LiveTurn[] = [];
  call.turns.forEach((t, i) => {
    if (t.utterance) out.push({ speaker: "rider", text: t.utterance, key: `${i}-r` });
    out.push({ speaker: "locus", text: t.lost ? `${t.instruction} (couldn't place the rider)` : t.instruction, key: `${i}-l` });
  });
  return out;
}

function CallFooter({ call }: { call: Call }) {
  if (call.noTranscript) return <p className="label">The rider asked not to be recorded, so there&rsquo;s no transcript.</p>;
  if (call.message) return <p className="small">Message for you: &ldquo;{call.message}&rdquo;</p>;
  if (call.handoff?.answered === false) return <p className="label">You missed the handoff call; the rider heard your note.</p>;
  if (call.handoff?.answered) return <p className="label">You took over the call.</p>;
  return null;
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}
