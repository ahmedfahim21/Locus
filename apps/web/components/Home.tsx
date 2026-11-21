"use client";

import { CaretRight, MapPinLine, PlayCircle, UserCircle, VideoCamera, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";
import { scriptNames, supabase, type Me } from "../lib/api";
import { useMe, useRoute } from "../lib/hooks";
import { AppearanceSwitch } from "./AppearanceSwitch";
import { Calls } from "./Calls";
import { DeliverySwitch } from "./DeliverySwitch";
import { RouteMap } from "./RouteMap";
import { TopBar } from "./TopBar";
import "./home.css";

export function Home() {
  const me = useMe();

  // A recipient with nothing set up yet goes straight into setup.
  const needsSetup = me.data && (!me.data.recipient || !me.data.home);
  useEffect(() => {
    if (needsSetup) window.location.replace(me.data!.recipient ? "/setup?step=door" : "/setup");
  }, [needsSetup, me.data]);

  if (me.error) {
    return (
      <main className="page">
        <TopBar />
        <div className="alert err" role="alert">
          <div className="stack" style={{ gap: 8 }}>
            <div>Couldn't load your details: {me.error}</div>
            <div className="row">
              <button className="btn compact" type="button" onClick={() => void me.reload()}>
                Try again
              </button>
              <button className="btn compact ghost" type="button" onClick={() => void supabase.auth.signOut()}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!me.data || needsSetup) {
    return (
      <main className="home" aria-busy="true">
        <div className="home-map skeleton" />
        <aside className="home-panel">
          <div className="skeleton" style={{ height: 96 }} />
          <div className="skeleton" style={{ height: 64 }} />
          <div className="skeleton" style={{ height: 180 }} />
        </aside>
      </main>
    );
  }

  return <HomeLoaded me={me.data} reload={me.reload} />;
}

function HomeLoaded({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const home = me.home!;
  const recipient = me.recipient!;
  const route = useRoute(true, home.confirmedAt);
  const stops = home.cues.map((c) => ({ name: c.landmark, location: c.location, alt: scriptNames(c.aliases), photoUrl: c.photoUrl, kind: c.kind, color: c.color }));
  const photos = home.cues.filter((c) => c.photoUrl).length;

  return (
    <main className="home">
      <div className="home-map">
        <RouteMap
          stops={stops}
          door={home.handoffPoint}
          legs={route.data?.legs ?? null}
          drawIn
          className="fill"
          padding={{ top: 120, bottom: 60, left: 80, right: 220 }}
          label="Your route from the first landmark to your door"
        />
        <div className="poster glass">
          <div className="street">{recipient.firstName}&rsquo;s door</div>
          <div className="label">
            DIGIPIN <span className="mono">{home.digipin}</span>
          </div>
        </div>
        {route.error && (
          <div className="map-banner alert err" role="alert">
            <Warning size={18} />
            <div className="stack" style={{ gap: 8 }}>
              <span>Couldn&rsquo;t draw your route: {route.error}</span>
              <button className="btn compact" type="button" onClick={() => void route.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}
        {route.data?.legs.some((l) => !l.onRoads) && (
          <div className="map-banner alert info glass small">
            <MapPinLine size={18} />
            <span>Dotted stretches have no road data nearby, so they&rsquo;re drawn straight.</span>
          </div>
        )}
      </div>

      <aside className="home-panel">
        <TopBar />
        <div className="home-title">
          <h1 className="title">Hi, {recipient.firstName}</h1>
          <p className="muted">Locus is ready to guide riders to your door.</p>
        </div>

        <DeliverySwitch me={me} onChange={reload} />
        <Calls />

        <section>
          <h2 className="section-label">Your route</h2>
          <ul className="group">
            <li>
              <Link className="cell" href="/setup?step=landmarks">
                <span className="cell-icon"><MapPinLine size={17} /></span>
                <div className="cell-main">
                  <span>Door and landmarks</span>
                  <span className="cell-sub">
                    {home.cues.length} landmark{home.cues.length === 1 ? "" : "s"}
                    {photos ? `, ${photos} with photos` : ""}
                  </span>
                </div>
                <CaretRight size={16} className="cell-end" />
              </Link>
            </li>
            <li>
              <Link className="cell" href="/setup?step=walk">
                <span className="cell-icon"><VideoCamera size={17} /></span>
                <div className="cell-main">
                  <span>Film your walk</span>
                  <span className="cell-sub">Find landmarks and photos from a short video</span>
                </div>
                <CaretRight size={16} className="cell-end" />
              </Link>
            </li>
            <li>
              <Link className="cell" href="/setup">
                <span className="cell-icon"><UserCircle size={17} /></span>
                <div className="cell-main">
                  <span>Your details</span>
                  <span className="cell-sub">{recipient.platforms.join(", ")}</span>
                </div>
                <CaretRight size={16} className="cell-end" />
              </Link>
            </li>
          </ul>
        </section>

        <ul className="group">
          <li>
            <Link className="cell" href="/replay">
              <span className="cell-icon"><PlayCircle size={17} /></span>
              <span className="cell-main">Hear a demo call</span>
              <CaretRight size={16} className="cell-end" />
            </Link>
          </li>
          <li>
            <div className="cell">
              <span className="cell-main">Appearance</span>
              <AppearanceSwitch />
            </div>
          </li>
          <li>
            <button className="cell" type="button" onClick={() => void supabase.auth.signOut()} style={{ color: "var(--danger)" }}>
              <span className="cell-main">Sign out</span>
              <span className="cell-end">{me.identity.email}</span>
            </button>
          </li>
        </ul>
      </aside>
    </main>
  );
}
