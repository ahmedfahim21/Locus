"use client";

import { ArrowRight, Check, Eraser, MicrophoneSlash, PlayCircle, VideoCamera } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { supabase } from "../lib/api";
import { AppearanceSwitch } from "./AppearanceSwitch";
import { Cast, type CastMember } from "./Cast";
import { DELIVERY_APPS, AppTile } from "./DeliveryApps";
import { DemoCall } from "./DemoCall";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { LogoMark } from "./Logo";
import { TopBar } from "./TopBar";
import "./landing.css";

const STEPS: { who: CastMember; title: string; body: string }[] = [
  { who: "door", title: "Pin your gate", body: "Drop the pin where a rider should stop: the gate, not the middle of the building." },
  { who: "landmark", title: "Walk it once", body: "Film the way in from the main road. Locus spots the boards, gates and gullies a rider will pass." },
  { who: "rider", title: "Switch it on", body: "Expecting a delivery? Flip the switch and give your Locus number as the receiver’s phone." },
];

const PRIVACY = [
  { Icon: VideoCamera, title: "Read, then deleted", body: "Your walk video is gone the moment its landmarks are found." },
  { Icon: Eraser, title: "No trail kept", body: "The GPS trace of your walk is wiped too. Only a small crop of each landmark stays." },
  { Icon: MicrophoneSlash, title: "Riders say no", body: "“Record mat karo” at any point, and nothing from that call is kept." },
];

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
    <main className="landing">
      <div className="landing-bar">
        <TopBar>
          <nav className="landing-nav" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#demo">Hear a call</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <button className="btn compact" type="button" onClick={() => void signIn()} disabled={busy}>
            Sign in
          </button>
        </TopBar>
      </div>

      <section className="hero">
        <span className="hero-eyebrow">
          <Cast who="rider" size={18} /> Voice AI for the last 200 metres
        </span>
        <h1 className="hero-title">Your rider, talked to your door.</h1>
        <p className="hero-sub">
          Lost riders call. Locus picks up in Hinglish, works out where they are from what they can see, and guides them,
          landmark by landmark.
        </p>
        <div className="hero-cta">
          <GoogleSignInButton onClick={() => void signIn()} busy={busy} />
          <a className="btn" href="#demo">
            <PlayCircle size={18} />
            Hear a call
          </a>
        </div>
        {error && (
          <p className="small" role="alert" style={{ color: "var(--danger)" }}>
            Couldn&rsquo;t start Google sign-in: {error}
          </p>
        )}
        <div className="works-with">
          <span className="label">Works with orders from</span>
          <ul className="app-row">
            {DELIVERY_APPS.map((app) => (
              <li key={app.id}>
                <AppTile app={app} size={36} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="phones" aria-label="Locus on your phone">
        <Phone className="phone-left" title="Your door">
          <MiniMap />
          <div className="ph-card">
            <div className="ph-row">
              <span>Expecting a delivery</span>
              <span className="ph-switch" aria-hidden="true" />
            </div>
            <span className="ph-sub">Locus answers riders for 38 min</span>
          </div>
          <div className="ph-card ph-row">
            <span className="ph-mono">+91 80 4718 0000</span>
            <span className="ph-sub">Your Locus number</span>
          </div>
        </Phone>

        <Phone className="phone-center" title="Rider on the line">
          <div className="ph-status">
            <span className="live-dot" /> Guiding · Swiggy order
          </div>
          <div className="ph-progress" aria-hidden="true">
            <span className="on" />
            <span className="on" />
            <span />
          </div>
          <ol className="ph-chat">
            <li className="rider">Bhaiya, grey gate pe hoon. Gate band hai.</li>
            <li className="locus">Doodh ki dukaan dikh rahi hai? Wahan se right lijiye.</li>
            <li className="rider">Haan, dikh gayi.</li>
            <li className="locus">Medical ke bagal wali gali. Neela gate hi ghar hai.</li>
            <li className="arrived">
              <Check size={14} /> Rider arrived
            </li>
          </ol>
        </Phone>

        <Phone className="phone-right" title="Landmarks we found">
          <ul className="ph-list">
            {[
              ["Grey gate", "main road se pehla mod", "#8d939b"],
              ["Nandini milk parlour", "laal building ke bagal mein", "#2f7ed8"],
              ["Apollo Pharmacy", "iske turant baad left mein patli gali", "#2fa56a"],
              ["Blue gate", "yahi ghar hai", "#2b6fd6"],
            ].map(([name, detail, color]) => (
              <li key={name}>
                <span className="ph-thumb" style={{ background: color }} />
                <span className="ph-item">
                  <span>{name}</span>
                  <span className="ph-sub">&ldquo;{detail}&rdquo;</span>
                </span>
                <span className="ph-check" aria-hidden="true">
                  <Check size={11} />
                </span>
              </li>
            ))}
          </ul>
        </Phone>
      </section>

      <section id="how" className="band">
        <div className="band-inner">
          <h2 className="band-title">Set up once. Every rider after that finds you.</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step">
                <Cast who={s.who} size={64} />
                <span className="step-n mono">{i + 1}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="demo" className="demo-band">
        <div className="band-head">
          <h2 className="band-title">Hear a real call.</h2>
          <p className="muted">Real streets in Hebbal, Bengaluru. The rider starts at the wrong gate.</p>
        </div>
        <DemoCall />
      </section>

      <section id="privacy" className="band">
        <div className="band-inner">
          <h2 className="band-title">Your walk is used once, then let go.</h2>
          <ul className="privacy">
            {PRIVACY.map(({ Icon, title, body }) => (
              <li key={title}>
                <span className="privacy-icon">
                  <Icon size={22} />
                </span>
                <h3>{title}</h3>
                <p className="muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="closing">
        <div className="cast-row" aria-hidden="true">
          <Cast who="rider" size={52} />
          <span className="cast-trail" />
          <Cast who="landmark" size={52} />
          <span className="cast-trail" />
          <Cast who="door" size={52} />
        </div>
        <h2 className="band-title">Ready when your next order is.</h2>
        <GoogleSignInButton onClick={() => void signIn()} busy={busy} />
      </section>

      <footer className="landing-foot">
        <span className="row label" style={{ gap: 8 }}>
          <LogoMark size={18} /> Locus · Talks your rider to your door
        </span>
        <AppearanceSwitch />
        <p className="label">
          Map data © OpenStreetMap contributors, tiles by OpenFreeMap. App names and marks belong to their owners; Locus isn&rsquo;t
          affiliated with them.
        </p>
        <Link href="/replay" className="label">
          Full demo call <ArrowRight size={12} />
        </Link>
      </footer>
    </main>
  );
}

/** A phone mock-up holding a real-looking Locus screen. */
function Phone({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return (
    <figure className={`phone ${className}`} aria-label={title}>
      <div className="phone-screen">
        <div className="phone-bar" aria-hidden="true">
          <span className="mono">9:41</span>
          <span className="phone-island" />
          <span className="phone-icons" />
        </div>
        <div className="phone-title">{title}</div>
        {children}
      </div>
    </figure>
  );
}

/** A tiny, cute map: blocks, a main road, the route drawing in, three landmarks and the door. */
function MiniMap() {
  return (
    <svg className="mini-map" viewBox="0 0 240 150" aria-hidden="true">
      <defs>
        <pattern id="mm-blocks" width="20" height="16" patternUnits="userSpaceOnUse">
          <rect x="2" y="2" width="16" height="12" rx="2.5" className="an-block" />
        </pattern>
      </defs>
      <rect width="240" height="150" rx="14" className="an-ground" />
      <rect width="240" height="150" rx="14" fill="url(#mm-blocks)" />
      <path d="M0 118 H240" className="an-road-main" />
      <path d="M48 118 V44 H150 V84 H200" className="an-road" />
      <path d="M48 118 V44 H150 V84 H200" className="an-route" pathLength={100} />
      {[
        [48, 80, 0],
        [100, 44, 1],
        [150, 64, 2],
      ].map(([x, y, i]) => (
        <g key={i} transform={`translate(${x} ${y})`} style={{ ["--i" as string]: i }}>
          <circle r="11" className="an-pin-ring" />
          <circle r="7" className="an-pin-dot" />
        </g>
      ))}
      <g transform="translate(200 84)">
        <circle r="13" className="an-door-pulse" />
        <circle r="6" className="an-door" />
      </g>
    </svg>
  );
}

