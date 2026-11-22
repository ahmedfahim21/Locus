"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, type Me, type Profile } from "../../lib/api";
import { AccountMenu } from "../AccountMenu";
import { AppTile, appById } from "../DeliveryApps";
import { TopBar } from "../TopBar";

const COMMON_APPS = ["swiggy", "zomato", "blinkit", "zepto", "instamart", "amazon", "flipkart", "bigbasket"];
const MAX_APPS = 6;
const E164 = /^\+\d{8,15}$/;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AboutStep({ me, progress, onDone }: { me: Me; progress: ReactNode; onDone: () => Promise<void> }) {
  const r = me.recipient;
  const [firstName, setFirstName] = useState(r?.firstName ?? me.identity.name?.split(" ")[0] ?? "");
  const [apps, setApps] = useState<string[]>(r?.platforms ?? []);
  const [otherApp, setOtherApp] = useState("");
  const [phone, setPhone] = useState(r?.phone ?? "+91");
  const [fallbackNote, setFallbackNote] = useState(r?.fallbackNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = [...COMMON_APPS, ...apps.filter((a) => !COMMON_APPS.includes(a))];
  const phoneOk = E164.test(phone.trim());
  const complete = firstName.trim() && apps.length > 0 && phoneOk && fallbackNote.trim();

  function toggleApp(app: string) {
    setApps((cur) => (cur.includes(app) ? cur.filter((a) => a !== app) : cur.length < MAX_APPS ? [...cur, app] : cur));
  }

  function addOther() {
    const app = otherApp.trim().toLowerCase();
    if (!app || apps.includes(app) || apps.length >= MAX_APPS) return;
    setApps((cur) => [...cur, app]);
    setOtherApp("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    try {
      const body: Profile = { firstName: firstName.trim(), platforms: apps, phone: phone.trim(), fallbackNote: fallbackNote.trim() };
      await api("/me/profile", { method: "PUT", body });
      await onDone();
    } catch (err) {
      console.error("[api] PUT /me/profile failed", err);
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <TopBar back={r ? { href: "/", label: "Home" } : undefined}>
        {progress}
        <AccountMenu />
      </TopBar>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="title">Who is the delivery for?</h1>
          <p className="muted">A rider has to say your first name and the app before Locus gives any directions.</p>
        </div>

        <label className="field">
          <span>Your first name, as it appears on orders</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={40} required />
        </label>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Apps you order from (up to {MAX_APPS})</span>
          <div className="row">
            {choices.map((app) => (
              <button
                key={app}
                type="button"
                className="chip"
                aria-pressed={apps.includes(app)}
                onClick={() => toggleApp(app)}
                disabled={!apps.includes(app) && apps.length >= MAX_APPS}
              >
                {appById(app) && <AppTile app={appById(app)!} size={22} />}
                {titleCase(app)}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <input
              value={otherApp}
              onChange={(e) => setOtherApp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOther();
                }
              }}
              placeholder="Another app"
              maxLength={30}
              style={{ flex: 1, minWidth: 160 }}
              disabled={apps.length >= MAX_APPS}
              aria-label="Another app"
            />
            <button className="btn compact" type="button" onClick={addOther} disabled={!otherApp.trim() || apps.length >= MAX_APPS}>
              Add
            </button>
          </div>
        </fieldset>

        <label className="field">
          <span>Your phone. Locus rings it if it can&rsquo;t place the rider.</span>
          <input
            className="mono"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[\s-]/g, ""))}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+919800000000"
            aria-invalid={phone.length > 3 && !phoneOk}
          />
          {phone.length > 3 && !phoneOk && <span style={{ color: "var(--danger)" }}>Use the full number with +91, e.g. +919800000000</span>}
        </label>

        <label className="field">
          <span>What the rider hears if you don&rsquo;t pick up</span>
          <input value={fallbackNote} onChange={(e) => setFallbackNote(e.target.value)} maxLength={200} placeholder="Leave it with the security guard" />
        </label>

        {error && (
          <div className="alert err" role="alert">
            <span>Couldn&rsquo;t save: {error}</span>
          </div>
        )}

        <div className="row">
          <button className="btn primary" type="submit" disabled={!complete || saving}>
            {saving ? "Saving…" : "Next: your door"}
            {!saving && <ArrowRight size={18} />}
          </button>
        </div>
      </form>
    </main>
  );
}
