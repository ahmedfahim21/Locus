"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, type Me } from "../lib/api";

function timeLeft(until: Date, now: Date) {
  const mins = Math.max(0, Math.round((until.getTime() - now.getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

/** "+918047182290" → "+91 80 4718 2290" for reading aloud. */
function spaced(number: string) {
  const m = /^\+91(\d{2})(\d{4})(\d{4})$/.exec(number);
  return m ? `+91 ${m[1]} ${m[2]} ${m[3]}` : number;
}

export function DeliverySwitch({ me, onChange }: { me: Me; onChange: () => Promise<void> }) {
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const until = me.recipient?.expectingDeliveryUntil ? new Date(me.recipient.expectingDeliveryUntil) : null;
  const on = until !== null && until > now;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api("/me/expecting", { method: "PUT", body: { on: !on } });
      await onChange();
    } catch (err) {
      console.error("[api] PUT /me/expecting failed", err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!me.number) return;
    try {
      await navigator.clipboard.writeText(me.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[clipboard] copy failed", err);
      setError("Couldn't copy. Select the number and copy it by hand.");
    }
  }

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="sheet" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
        <div>
          <h2 className="heading">Expecting a delivery?</h2>
          <p className="label">
            {on ? `On for ${timeLeft(until!, now)}. Locus guides riders only while this is on.` : "Off. Locus won't give anyone directions."}
          </p>
        </div>
        <button className="switch" role="switch" aria-checked={on} aria-label="Expecting a delivery" onClick={() => void toggle()} disabled={busy} />
      </div>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--kumkum)" }}>
          {error}
        </p>
      )}
      {me.number ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Your Locus number</span>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="mono" style={{ fontSize: 24 }}>{spaced(me.number)}</span>
            <button className="btn compact" type="button" onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="label">Forward unanswered calls here, or give it as the receiver&rsquo;s number when you order.</span>
        </div>
      ) : (
        <p className="label">No Locus number assigned to you yet.</p>
      )}
    </section>
  );
}
