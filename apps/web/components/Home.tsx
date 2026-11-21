"use client";

import { ArrowRight, MapPinLine, PlayCircle, SignOut, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";
import { supabase, type Me } from "../lib/api";
import { useMe, useRoute } from "../lib/hooks";
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
  const stops = home.cues.map((c) => ({ name: c.landmark, location: c.location }));

  return (
    <main className="home">
      <div className="home-map">
        <RouteMap
          stops={stops}
          door={home.handoffPoint}
          legs={route.data?.legs ?? null}
          drawIn
          className="fill"
          padding={{ top: 130, bottom: 60, left: 150, right: 150 }}
          label="Your route from the first landmark to your door"
        />
        <div className="poster">
          <div className="street">{recipient.firstName}&rsquo;s door</div>
          <div className="label">
            DIGIPIN <span className="mono">{home.digipin}</span> · {home.cues.length} landmark{home.cues.length === 1 ? "" : "s"}
          </div>
        </div>
        {route.error && (
          <div className="map-banner alert err" role="alert">
            <div className="stack" style={{ gap: 6 }}>
              <span>Couldn't draw your route: {route.error}</span>
              <button className="btn compact" type="button" onClick={() => void route.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}
        {route.data?.legs.some((l) => !l.onRoads) && (
          <div className="map-banner alert info small">
            <MapPinLine size={18} />
            <span>Dotted stretches have no road data nearby yet, so they're drawn as straight lines.</span>
          </div>
        )}
      </div>

      <aside className="home-panel">
        <TopBar>
          <Link className="btn ghost icon compact" href="/replay" aria-label="Hear a demo call" title="Hear a demo call" style={{ width: 40 }}>
            <PlayCircle size={20} />
          </Link>
          <button
            className="btn ghost icon compact"
            type="button"
            onClick={() => void supabase.auth.signOut()}
            aria-label="Sign out"
            title={`Sign out ${me.identity.email ?? ""}`}
            style={{ width: 40 }}
          >
            <SignOut size={20} />
          </button>
        </TopBar>

        <DeliverySwitch me={me} onChange={reload} />
        <Calls />

        <section className="stack" style={{ gap: 8 }}>
          <Link className="btn block" href="/setup?step=landmarks">
            <MapPinLine size={18} />
            Edit door and landmarks
            <ArrowRight size={16} style={{ marginLeft: "auto" }} />
          </Link>
          <Link className="btn block ghost" href="/setup">
            <UserCircle size={18} />
            Edit your details
            <ArrowRight size={16} style={{ marginLeft: "auto" }} />
          </Link>
        </section>
      </aside>
    </main>
  );
}
