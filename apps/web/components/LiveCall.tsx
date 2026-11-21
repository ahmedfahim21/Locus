"use client";

import { Moped, Waveform } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { LatLon, RouteLeg } from "../lib/api";
import { RouteMap, type Stop } from "./RouteMap";
import "./live-call.css";

export type LiveTurn = { speaker: "rider" | "locus"; text: string; key: string };

/**
 * The projector view of a call (DESIGN.md "Layout"): the map on the left two
 * thirds with the street poster, the status and transcript on the right.
 */
export function LiveCall({
  stops,
  door,
  legs,
  reached,
  arrived,
  live,
  statusLabel,
  statusText,
  poster,
  posterSub,
  timer,
  turns,
  note,
  footer,
  activeTurn,
  onTurnClick,
}: {
  stops: Stop[];
  door: LatLon;
  legs: RouteLeg[] | null;
  reached: number;
  arrived: boolean;
  live: boolean;
  statusLabel: string;
  statusText: string;
  poster: string;
  posterSub?: ReactNode;
  timer?: string;
  turns: LiveTurn[];
  note?: string | null;
  footer?: ReactNode;
  activeTurn?: number;
  onTurnClick?: (index: number) => void;
}) {
  const transcript = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = transcript.current;
    if (!el) return;
    const active = activeTurn !== undefined ? el.children[activeTurn] : el.lastElementChild;
    active?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns.length, activeTurn]);

  const steps = stops.length + (arrivedIsSeparateStop(stops, door) ? 1 : 0);
  const done = arrived ? steps : reached;

  return (
    <section className="stage">
      <div className="stage-map">
        <RouteMap
          stops={stops}
          door={door}
          legs={legs}
          reached={reached}
          arrived={arrived}
          note={note}
          drawIn
          className="fill"
          padding={{ top: 130, bottom: 60, left: 150, right: 150 }}
          label="Map of the rider's route to the door"
        />
        <div className="poster">
          <div className="street">{poster}</div>
          {posterSub && <div className="label">{posterSub}</div>}
        </div>
        {(live || timer) && (
          <div className="callbar">
            {live && <span className="live-dot" />}
            <span className="label" style={{ color: "var(--ink)" }}>{live ? "Rider on call" : "Call"}</span>
            {timer && <span className="mono">{timer}</span>}
          </div>
        )}
      </div>
      <aside className="stage-side">
        <div className="stage-status" role="status">
          <div className="label">{statusLabel}</div>
          <div className="heading now">{statusText}</div>
          <div className="progress" aria-label={`${done} of ${steps} stops reached`}>
            {Array.from({ length: steps }, (_, i) => (
              <span key={i} className={i < done ? "done" : ""} />
            ))}
          </div>
        </div>
        <ol className="transcript" ref={transcript} aria-label="Call transcript">
          {turns.length === 0 && <li className="label empty">Nothing said yet.</li>}
          {turns.map((t, i) => {
            const body = (
              <>
                <span className="who label">
                  {t.speaker === "locus" ? <Waveform size={14} /> : <Moped size={14} />}
                  {t.speaker === "locus" ? "Locus" : "Rider"}
                </span>
                <span className="text">{t.text}</span>
              </>
            );
            return (
              <li key={t.key} className={`turn ${t.speaker}`} aria-current={activeTurn === i ? "step" : undefined}>
                {onTurnClick ? (
                  <button type="button" onClick={() => onTurnClick(i)}>
                    {body}
                  </button>
                ) : (
                  <div>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
        {footer && <div className="stage-footer">{footer}</div>}
      </aside>
    </section>
  );
}

function arrivedIsSeparateStop(stops: Stop[], door: LatLon) {
  const last = stops[stops.length - 1];
  if (!last) return true;
  // Same threshold as the API's route: a last landmark within ~15 m is the door.
  const dLat = (last.location.lat - door.lat) * 111_320;
  const dLon = (last.location.lon - door.lon) * 111_320 * Math.cos((door.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) > 15;
}
