"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmailSignIn } from "../../components/EmailSignIn";
import { GoogleSignInButton } from "../../components/GoogleSignInButton";
import { LogoMark } from "../../components/Logo";
import { TopBar } from "../../components/TopBar";
import { supabase } from "../../lib/api";
import { useAuthSession } from "../../lib/hooks";

/** Where to go after signing in: a path on this site from `?next=`, else home. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function SignInPage() {
  const router = useRouter();
  const session = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in (already, by email, or back from Google): go where the visitor was heading.
  useEffect(() => {
    if (session) router.replace(nextPath());
  }, [session, router]);

  async function google() {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/sign-in${window.location.search}` },
    });
    if (err) {
      console.error("[auth] Google sign-in failed", err);
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar back={{ href: "/", label: "Home" }} />
      {session === null ? (
        <div className="stack" style={{ gap: 24, maxWidth: 380, width: "100%", margin: "0 auto", paddingTop: 24 }}>
          <div className="stack" style={{ gap: 10, justifyItems: "center", textAlign: "center" }}>
            <LogoMark size={44} />
            <h1 className="display" style={{ fontSize: 32 }}>Sign in to Locus</h1>
            <p className="muted">Set up your door, switch Locus on, and see every call.</p>
          </div>
          <div style={{ display: "grid", justifyItems: "center" }}>
            <GoogleSignInButton onClick={() => void google()} busy={busy} />
          </div>
          {error && (
            <p className="small" role="alert" style={{ color: "var(--danger)", textAlign: "center" }}>
              Couldn&rsquo;t start Google sign-in: {error}
            </p>
          )}
          <div className="row label" style={{ gap: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--separator)" }} />
            or with email
            <span style={{ flex: 1, height: 1, background: "var(--separator)" }} />
          </div>
          <EmailSignIn />
          <p className="small muted" style={{ textAlign: "center" }}>
            Email sign-in is for test accounts. <Link href="/replay">Hear a demo call</Link> without signing in.
          </p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16, maxWidth: 380, width: "100%", margin: "0 auto", paddingTop: 24 }} aria-busy="true">
          <div className="skeleton" style={{ height: 120 }} />
          <div className="skeleton" style={{ height: 220 }} />
        </div>
      )}
    </main>
  );
}
