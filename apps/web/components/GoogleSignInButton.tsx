"use client";

/**
 * "Continue with Google", built to Google's sign-in branding guidelines
 * (developers.google.com/identity/branding-guidelines): the official standard-colour
 * G on its button, Google Sans Medium 14/20, Google's light or dark colours following
 * the app theme, pill shape, 12 px before the G, 10 px after it, 12 px after the text.
 */
export function GoogleSignInButton({ onClick, busy, label = "Continue with Google" }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button className="gsi-button" type="button" onClick={onClick} disabled={busy} aria-busy={busy}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Google's own logo asset, shown unaltered */}
      <img src="/google-g.png" alt="" width={20} height={20} className="gsi-logo" />
      <span className="gsi-text">{busy ? "Opening Google…" : label}</span>
    </button>
  );
}
