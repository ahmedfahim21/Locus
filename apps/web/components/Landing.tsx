"use client";

import { GoogleLogo, PlayCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { supabase } from "../lib/api";
import { DemoCall } from "./DemoCall";
import { TopBar } from "./TopBar";

export function Landing() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    if (err) {
      console.error("[auth] Google sign-in failed", err);
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar>
        <button className="btn compact" type="button" onClick={() => void signIn()} disabled={busy}>
          Sign in
        </button>
      </TopBar>
      <section className="stack" style={{ gap: 18, maxWidth: 760, padding: "40px 0 8px", justifyItems: "start" }}>
        <span className="label" style={{ padding: "4px 10px", borderRadius: 999, background: "var(--card)" }}>Voice AI for delivery riders</span>
        <h1 className="display">Your rider, talked to your door.</h1>
        <p className="muted" style={{ fontSize: 19, maxWidth: "50ch" }}>
          When a rider calls, Locus answers in Hinglish and guides them landmark by landmark, using real streets around
          your home and the route you set once.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary" type="button" onClick={() => void signIn()} disabled={busy}>
            <GoogleLogo size={18} />
            {busy ? "Opening Google…" : "Set up my door"}
          </button>
          <Link className="btn" href="/replay">
            <PlayCircle size={18} />
            Hear a demo call
          </Link>
        </div>
        {error && (
          <p className="small" style={{ color: "var(--danger)" }}>
            Couldn&rsquo;t start Google sign-in: {error}
          </p>
        )}
      </section>
      <DemoCall />
      <section>
        <h2 className="section-label">How it works</h2>
        <ul className="group">
          {[
            ["Pin your gate", "Move the map until the pin sits on your gate. That's where Locus brings the rider."],
            ["Film the way in", "A 60-second walk from the main road. Locus finds the shops and gates a rider will see."],
            ["Switch it on", "Turn on “Expecting a delivery” and give your Locus number as the receiver's number."],
          ].map(([title, body], i) => (
            <li key={title}>
              <div className="cell" style={{ alignItems: "flex-start", padding: "14px 16px" }}>
                <span className="cell-icon mono" style={{ fontSize: 14 }}>{i + 1}</span>
                <div className="cell-main">
                  <span>{title}</span>
                  <span className="muted small">{body}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="label" style={{ textAlign: "center" }}>Map data © OpenStreetMap contributors, tiles by OpenFreeMap.</p>
    </main>
  );
}
