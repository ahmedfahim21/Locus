"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { demoDoor, demoLegs, demoStops, demoStreets, demoTurns } from "../lib/demoCall";
import { LiveCall } from "./LiveCall";

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function lastTurnAt(time: number) {
  let index = 0;
  demoTurns.forEach((t, i) => {
    if (t.time <= time) index = i;
  });
  return index;
}

/** The scripted demo call, driven by the audio's playback position. */
export function DemoCall() {
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);

  const active = started ? lastTurnAt(time) : -1;
  const shown = demoTurns.slice(0, active + 1);
  const current = active >= 0 ? demoTurns[active]! : null;
  const reached = current?.reached ?? 0;
  const arrived = current?.arrived ?? false;
  const lastLocus = [...shown].reverse().find((t) => t.speaker === "locus");
  const nextStop = demoStops[reached];

  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      if (el.ended) el.currentTime = 0;
      setStarted(true);
      await el.play();
    } else {
      el.pause();
    }
  }

  function seek(index: number) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = demoTurns[index]!.time;
    setTime(el.currentTime);
    setStarted(true);
  }

  return (
    <>
      <LiveCall
        stops={demoStops}
        door={demoDoor}
        legs={demoLegs}
        reached={reached}
        arrived={arrived}
        live={playing}
        timer={clock(time)}
        poster={demoStreets[arrived ? demoStreets.length - 1 : Math.max(0, reached - 1)]!}
        posterSub={
          <>
            Hebbal, Bengaluru · DIGIPIN <span className="mono">4P3JK852C9</span>
          </>
        }
        statusLabel={arrived ? "Arrived" : started ? "Guiding to" : "Ready"}
        statusText={arrived ? "At the blue gate" : started ? (nextStop?.name ?? "Blue gate") : "Press play to hear the call"}
        turns={shown.map((t, i) => ({ speaker: t.speaker, text: t.text, key: String(i) }))}
        note={!arrived && lastLocus ? lastLocus.text : null}
        activeTurn={active >= 0 ? active : undefined}
        onTurnClick={seek}
        doorProp={{ kind: "gate", color: "#2f6fd6" }}
        footer={
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn primary" type="button" onClick={() => void toggle()}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {playing ? "Pause" : started ? "Resume" : "Play the call"}
            </button>
            <span className="label">Tap a line to jump to it</span>
          </div>
        }
      />
      <audio
        ref={audio}
        preload="auto"
        src="/replay/wrong-gate.mp3"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={(e) => console.error("[demo] audio failed to load", e.currentTarget.error)}
      />
    </>
  );
}
