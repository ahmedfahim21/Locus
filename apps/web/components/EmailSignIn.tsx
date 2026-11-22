"use client";

import { useState } from "react";
import { supabase } from "../lib/api";

/** Email and password sign-in, for test accounts (AGENTS.md lists them). There is no sign-up here: new people use Google. */
export function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // On success the sign-in page sees the new session and moves on.
    if (err) {
      console.error("[auth] email sign-in failed", err);
      setError(err.message === "Invalid login credentials" ? "That email and password don't match a test account." : err.message);
      setBusy(false);
    }
  }

  return (
    <form
      className="stack"
      style={{ gap: 10, width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        void signIn();
      }}
    >
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="btn primary block" type="submit" disabled={busy || !email.trim() || !password} aria-busy={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
