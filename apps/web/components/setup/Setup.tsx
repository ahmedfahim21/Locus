"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { LatLon, Me } from "../../lib/api";
import { useMe } from "../../lib/hooks";
import { TopBar } from "../TopBar";
import { AboutStep } from "./AboutStep";
import { DoorStep } from "./DoorStep";
import { LandmarksStep } from "./LandmarksStep";
import "./setup.css";

export type Step = "about" | "door" | "landmarks";
const STEPS: Step[] = ["about", "door", "landmarks"];

function stepFrom(param: string | null): Step {
  return STEPS.includes(param as Step) ? (param as Step) : "about";
}

export function Setup() {
  const me = useMe();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>(() => stepFrom(params.get("step")));
  const [door, setDoor] = useState<LatLon | null>(null);

  // Keep the URL in step with the screen so reload and back work.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("step") !== step) {
      url.searchParams.set("step", step);
      window.history.replaceState(null, "", url);
    }
  }, [step]);

  if (me.error) {
    return (
      <main className="page">
        <TopBar back={{ href: "/", label: "Back to home" }} />
        <div className="alert err" role="alert">
          <div className="stack" style={{ gap: 8 }}>
            <span>Couldn&rsquo;t load your details: {me.error}</span>
            <button className="btn compact" type="button" onClick={() => void me.reload()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }
  if (!me.data) {
    return (
      <main className="page" aria-busy="true">
        <div className="skeleton" style={{ width: 160, height: 28 }} />
        <div className="skeleton" style={{ height: 360 }} />
      </main>
    );
  }

  // Steps that need earlier ones send you back to the first one missing.
  const data: Me = me.data;
  const effective: Step = !data.recipient ? "about" : step === "landmarks" && !door && !data.home ? "door" : step;
  const index = STEPS.indexOf(effective);
  const progress = (
    <span className="label" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      Step {index + 1} of {STEPS.length}
    </span>
  );

  if (effective === "about") {
    return (
      <AboutStep
        me={data}
        progress={progress}
        onDone={async () => {
          await me.reload();
          setStep("door");
        }}
      />
    );
  }
  if (effective === "door") {
    return (
      <DoorStep
        initial={door ?? data.home?.handoffPoint ?? null}
        progress={progress}
        onBack={() => setStep("about")}
        onDone={(point) => {
          setDoor(point);
          setStep("landmarks");
        }}
      />
    );
  }
  return (
    <LandmarksStep
      me={data}
      door={door ?? data.home!.handoffPoint}
      progress={progress}
      onBack={() => setStep("door")}
      onDone={() => window.location.assign("/")}
    />
  );
}
