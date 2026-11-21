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
      <section className="stack" style={{ gap: 16, maxWidth: 720, paddingTop: 24 }}>
        <h1 className="display">It knows my street.</h1>
        <p className="muted" style={{ fontSize: 19, maxWidth: "52ch" }}>
          When a delivery rider calls, Locus answers in Hinglish and talks them to your door, landmark by landmark,
          using the route you set once.
        </p>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn primary" type="button" onClick={() => void signIn()} disabled={busy}>
            <GoogleLogo size={20} />
            {busy ? "Opening Google…" : "Set up my door"}
          </button>
          <Link className="btn ghost" href="/replay">
            <PlayCircle size={20} />
            Hear a demo call
          </Link>
        </div>
        {error && (
          <p className="small" style={{ color: "var(--kumkum)" }}>
            Couldn't start Google sign-in: {error}
          </p>
        )}
      </section>
      <DemoCall />
      <section className="grid2" style={{ gap: 24 }}>
        {[
          ["Mark your gate", "Move the map until the red × sits on your gate. That's where Locus brings the rider."],
          ["Name the landmarks", "The bakery, the temple, the chai stall: what a rider would actually see, in the order they pass them."],
          ["Switch it on", "Turn on “Expecting a delivery” and forward unanswered calls to your Locus number."],
        ].map(([title, body], i) => (
          <div key={title} className="stack" style={{ gap: 6, borderTop: "1.5px solid var(--ink)", paddingTop: 12 }}>
            <span className="label">{i + 1}</span>
            <h2 className="heading">{title}</h2>
            <p className="muted">{body}</p>
          </div>
        ))}
      </section>
      <p className="label">Map data © OpenStreetMap contributors, tiles by OpenFreeMap.</p>
    </main>
  );
}
