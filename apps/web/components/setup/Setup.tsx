"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { LatLon, Me, Suggestion } from "../../lib/api";
import { useMe } from "../../lib/hooks";
import { AccountMenu } from "../AccountMenu";
import { TopBar } from "../TopBar";
import { AboutStep } from "./AboutStep";
import { DoorStep } from "./DoorStep";
import { LandmarksStep } from "./LandmarksStep";
import { SuggestStep } from "./SuggestStep";
import { WalkStep, type KeptProposal } from "./WalkStep";
import "./setup.css";

export type Step = "about" | "door" | "walk" | "suggest" | "landmarks";
const STEPS: Step[] = ["about", "door", "walk", "suggest", "landmarks"];

function stepFrom(param: string | null): Step {
  return STEPS.includes(param as Step) ? (param as Step) : "about";
}

export function Setup() {
  const me = useMe();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>(() => stepFrom(params.get("step")));
  const [door, setDoor] = useState<LatLon | null>(null);
  const [walkRenames, setWalkRenames] = useState<Map<string, string>>(new Map());
  const [skippedProposals, setSkippedProposals] = useState<Set<string>>(new Set());
  const [fromSuggestions, setFromSuggestions] = useState<Suggestion[]>([]);

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
        <TopBar back={{ href: "/", label: "Home" }}>
          <AccountMenu />
        </TopBar>
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
  const needsDoor = (step === "walk" || step === "suggest" || step === "landmarks") && !door && !data.home;
  const effective: Step = !data.recipient ? "about" : needsDoor ? "door" : step;
  const index = STEPS.indexOf(effective);
  const progress = (
    <span className="step-dots" role="img" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <i key={s} className={i === index ? "on" : undefined} />
      ))}
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
          setStep("walk");
        }}
      />
    );
  }
  if (effective === "walk") {
    return (
      <WalkStep
        door={door ?? data.home!.handoffPoint}
        progress={progress}
        onBack={() => setStep("door")}
        onSkip={() => setStep("suggest")}
        onDone={(kept: KeptProposal[], skipped: string[]) => {
          setWalkRenames(new Map(kept.filter((p) => p.keptName !== p.name).map((p) => [p.id, p.keptName])));
          setSkippedProposals(new Set(skipped));
          setStep("suggest");
        }}
      />
    );
  }
  if (effective === "suggest") {
    return (
      <SuggestStep
        door={door ?? data.home!.handoffPoint}
        skippedProposals={skippedProposals}
        renames={walkRenames}
        progress={progress}
        onBack={() => setStep("walk")}
        onDone={(kept) => {
          setFromSuggestions(kept);
          setStep("landmarks");
        }}
      />
    );
  }
  return (
    <LandmarksStep
      me={data}
      door={door ?? data.home!.handoffPoint}
      fromSuggestions={fromSuggestions}
      progress={progress}
      onBack={() => setStep("walk")}
      onDone={() => window.location.assign("/")}
    />
  );
}
