"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/** What Locus does with a walk, in order. Timings only pace the animation; "done" comes from the API. */
const VIDEO_STEPS = [
  "Uploading your walk",
  "Picking the sharpest frame every 10 m",
  "Reading shop boards, gates and temples",
  "Matching names to the map",
  "Writing names in Hindi and your state\u2019s language",
];
const PHOTO_STEPS = [
  "Uploading your photos",
  "Looking at each photo",
  "Reading shop boards, gates and temples",
  "Matching names to the map",
  "Writing names in Hindi and your state\u2019s language",
];
/** Seconds after upload when each later step starts showing; the last one holds until the API says ready. */
const STEP_AT_S = [0, 4, 10, 16];

/**
 * The stage beside the panel while a walk uploads and is read: a little map whose
 * route draws in and whose landmarks pop up, over a strip of the recipient's own
 * frames with a scan sweeping across them.
 */
export function AnalysingStage({ thumbs, photos }: { thumbs: string[]; photos: boolean }) {
  return (
    <div className="analysing-stage" aria-hidden="true">
      <svg className="analysing-map" viewBox="0 0 320 200">
        <defs>
          <pattern id="an-blocks" width="22" height="18" patternUnits="userSpaceOnUse">
            <rect x="2" y="2" width="18" height="14" rx="2" className="an-block" />
          </pattern>
        </defs>
        <rect width="320" height="200" rx="18" className="an-ground" />
        <rect width="320" height="200" rx="18" fill="url(#an-blocks)" />
        <path d="M0 150 H320" className="an-road-main" />
        <path d="M70 150 V60 H190 V110 H260" className="an-road" />
        <path d="M70 150 V60 H190 V110 H260" className="an-route" pathLength={100} />
        {[
          [70, 105, 0],
          [130, 60, 1],
          [190, 85, 2],
        ].map(([x, y, i]) => (
          <g key={i} className="an-pin" style={{ ["--i" as string]: i }} transform={`translate(${x} ${y})`}>
            <circle r="13" className="an-pin-ring" />
            <circle r="8" className="an-pin-dot" />
          </g>
        ))}
        <g transform="translate(260 110)">
          <circle r="16" className="an-door-pulse" />
          <circle r="7" className="an-door" />
        </g>
      </svg>

      {thumbs.length > 0 && (
        <div className={`analysing-strip${photos ? " photos" : ""}`}>
          {thumbs.map((src, i) => (
            <div key={src} className="an-frame" style={{ ["--i" as string]: i, ["--n" as string]: thumbs.length }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local previews of the recipient's own frames */}
              <img src={src} alt="" />
            </div>
          ))}
          <div className="an-beam" />
        </div>
      )}
    </div>
  );
}

/** The panel's step list. `uploading` holds the first step; after it, steps advance on a timer. */
export function AnalysingSteps({ uploading, photos, detail }: { uploading: boolean; photos: boolean; detail: string }) {
  const steps = photos ? PHOTO_STEPS : VIDEO_STEPS;
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (uploading) return setSince(null);
    setSince(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [uploading]);

  const elapsedS = since === null ? -1 : (now - since) / 1000;
  const active = uploading ? 0 : 1 + STEP_AT_S.filter((t) => elapsedS >= t).length - 1;

  return (
    <div className="stack" style={{ gap: 14 }} aria-busy="true" role="status">
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">{uploading ? (photos ? "Sending your photos" : "Sending your walk") : "Finding landmarks"}</h1>
        <p className="muted">{detail}</p>
      </div>
      <ol className="analysing-steps" aria-live="polite">
        {steps.map((step, i) => {
          const state = i < active ? "done" : i === active ? "active" : "todo";
          return (
            <li key={step} className={`an-step ${state}`}>
              <span className="an-step-mark">{state === "done" ? <Check size={12} weight="bold" /> : null}</span>
              <span>{step}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Small thumbnails from a recorded walk, read in the browser. MediaRecorder files
 * often report no duration, so the caller passes the recorded length.
 */
export async function videoThumbs(blob: Blob, durationS: number, count = 6): Promise<string[]> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const once = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`video ${event} timed out`)), 8000);
      video.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
      video.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`video error ${video.error?.code ?? ""}`))), { once: true });
    });
  try {
    await once("loadeddata");
    const canvas = document.createElement("canvas");
    const w = 240;
    canvas.width = w;
    canvas.height = Math.round((w * (video.videoHeight || 9)) / (video.videoWidth || 16));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas");
    const thumbs: string[] = [];
    for (let i = 0; i < count; i++) {
      video.currentTime = Math.min(durationS - 0.2, ((i + 0.5) / count) * durationS);
      await once("seeked");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbs.push(canvas.toDataURL("image/jpeg", 0.7));
    }
    return thumbs;
  } finally {
    URL.revokeObjectURL(url);
  }
}
