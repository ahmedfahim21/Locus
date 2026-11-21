"use client";

import { CaretRight, Check, Copy, Phone } from "@phosphor-icons/react";
import Link from "next/link";
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

/** The "Deliveries" group: the expecting switch, the Locus number, and a test call. */
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
    <section>
      <h2 className="section-label">Deliveries</h2>
      <ul className="group">
        <li>
          <div className="cell">
            <div className="cell-main">
              <span>Expecting a delivery</span>
              <span className="cell-sub">{on ? `Locus answers riders for ${timeLeft(until!, now)}` : "Off. Locus won't give anyone directions."}</span>
            </div>
            <button className="switch" role="switch" aria-checked={on} aria-label="Expecting a delivery" onClick={() => void toggle()} disabled={busy} />
          </div>
        </li>
        <li>
          {me.number ? (
            <button className="cell" type="button" onClick={() => void copy()} aria-label={`Copy your Locus number ${me.number}`}>
              <div className="cell-main">
                <span className="mono" style={{ fontSize: 17 }}>{spaced(me.number)}</span>
                <span className="cell-sub">Your Locus number. Give it as the receiver&rsquo;s number when you order.</span>
              </div>
              <span className="cell-end">{copied ? <Check size={18} /> : <Copy size={18} />}</span>
            </button>
          ) : (
            <div className="cell">
              <div className="cell-main">
                <span>No Locus number yet</span>
                <span className="cell-sub">You can still try Locus from the browser.</span>
              </div>
            </div>
          )}
        </li>
        <li>
          <Link className="cell" href="/test-call">
            <span className="cell-icon" style={{ background: "var(--ink)", color: "var(--on-ink)" }}>
              <Phone size={17} />
            </span>
            <div className="cell-main">
              <span>Try a call</span>
              <span className="cell-sub">Play the rider with your mic and hear Locus guide you.</span>
            </div>
            <CaretRight size={16} className="cell-end" />
          </Link>
        </li>
      </ul>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--danger)", padding: "8px 16px 0" }}>
          {error}
        </p>
      )}
    </section>
  );
}
