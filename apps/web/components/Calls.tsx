"use client";

import { CaretRight, PhoneIncoming } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, LIVE_STATES, STATE_LABEL, type Call } from "../lib/api";
import { AppTile, appById } from "./DeliveryApps";

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

/** "Calls" group: newest first, live ones marked; each opens the call view. */
export function Calls() {
  const { calls, error } = useCalls();

  return (
    <section>
      <h2 className="section-label">Calls</h2>
      {calls === null && !error && <div className="skeleton" style={{ height: 104, borderRadius: "var(--radius)" }} />}
      {calls?.length === 0 && (
        <div className="group">
          <div className="cell">
            <span className="cell-icon">
              <PhoneIncoming size={17} />
            </span>
            <div className="cell-main">
              <span>No calls yet</span>
              <span className="cell-sub">When a rider calls, watch them get guided here.</span>
            </div>
          </div>
        </div>
      )}
      {calls && calls.length > 0 && (
        <ul className="group">
          {calls.map((c) => {
            const live = LIVE_STATES.has(c.state);
            const last = c.turns[c.turns.length - 1];
            const app = c.app ? appById(c.app) : undefined;
            return (
              <li key={c.id}>
                <Link href={`/calls/${c.id}`} className="cell call-row">
                  {/* The app the rider named, by its logo; a phone when he didn't say, or Locus has no logo for it. */}
                  {app ? (
                    <AppTile app={app} size={30} />
                  ) : (
                    <span className="cell-icon" title={c.app ?? undefined}>
                      <PhoneIncoming size={17} />
                    </span>
                  )}
                  <div className="cell-main">
                    <span className="row" style={{ gap: 8 }}>
                      {live && <span className="live-dot" aria-label="Live" />}
                      {STATE_LABEL[c.state] ?? c.state}
                      {c.app && <span className="cell-sub">· {app?.name ?? c.app}</span>}
                    </span>
                    <span className="cell-sub">
                      {c.noTranscript ? "Rider asked not to be recorded" : last ? (last.utterance ?? last.instruction) : "No words yet"}
                    </span>
                  </div>
                  <span className="cell-end">
                    {new Date(c.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    <CaretRight size={14} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: "var(--danger)", padding: "8px 16px 0" }}>
          Couldn&rsquo;t refresh calls: {error}. Retrying every few seconds.
        </p>
      )}
    </section>
  );
}
