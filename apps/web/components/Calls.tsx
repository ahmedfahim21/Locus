"use client";

import { CaretRight, PhoneIncoming } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, LIVE_STATES, STATE_LABEL, type Call } from "../lib/api";

const POLL_MS = 3000;

/** Polls the recipient's recent calls; each opens the live/replay view. */
export function useCalls() {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await api<{ calls: Call[] }>("/me/calls");
        if (stopped) return;
        setCalls(res.calls);
        setError(null);
      } catch (err) {
        console.error("[api] GET /me/calls failed", err);
        if (!stopped) setError((err as Error).message);
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return { calls, error };
}

export function Calls() {
  const { calls, error } = useCalls();

  return (
    <section className="stack" style={{ gap: 8 }}>
      <h2 className="heading">Rider calls</h2>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--kumkum)" }}>
          Couldn&rsquo;t refresh calls: {error}. Retrying every few seconds.
        </p>
      )}
      {calls === null && !error && <div className="skeleton" style={{ height: 120 }} />}
      {calls?.length === 0 && (
        <div className="alert info">
          <PhoneIncoming size={20} />
          <div>
            <div>No calls yet</div>
            <div className="label">When a rider calls, you can watch them get guided here.</div>
          </div>
        </div>
      )}
      {calls && calls.length > 0 && (
        <ul className="sheet" style={{ listStyle: "none", margin: 0, padding: 0, gap: 0 }}>
          {calls.map((c, i) => {
            const live = LIVE_STATES.has(c.state);
            const last = c.turns[c.turns.length - 1];
            return (
              <li key={c.id} style={{ borderTop: i ? "1px dashed var(--ghost-deep)" : 0 }}>
                <Link href={`/calls/${c.id}`} className="call-row">
                  <span className="row" style={{ gap: 8 }}>
                    {live && <span className="live-dot" aria-label="Live" />}
                    <span>{STATE_LABEL[c.state] ?? c.state}</span>
                  </span>
                  <span className="mono label">{new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="label preview">
                    {c.noTranscript ? "Rider asked not to be recorded" : last ? (last.utterance ?? last.instruction) : "No words yet"}
                  </span>
                  <CaretRight size={16} className="caret" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
