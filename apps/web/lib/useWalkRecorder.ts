"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackPoint } from "./api";

/** The API refuses walks longer than 3 minutes; stop a little before. */
export const MAX_RECORD_S = 170;
/**
 * 720p at ~1.8 Mbps: the longest walk (MAX_RECORD_S) stays near 38 MB, under the
 * 50 MB upload cap (2.5 Mbps went over it past ~2:40). Vision reads 768 px frames,
 * so this is still more detail than it uses.
 */
const VIDEO_BITS_PER_SECOND = 1_800_000;

type Format = { recorderType: string; contentType: "video/mp4" | "video/webm" };

/** The first format this browser can record: MP4 on Safari (and newer Chrome), WebM elsewhere. */
function pickFormat(): Format | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Format[] = [
    { recorderType: "video/mp4;codecs=avc1", contentType: "video/mp4" },
    { recorderType: "video/mp4", contentType: "video/mp4" },
    { recorderType: "video/webm;codecs=vp9", contentType: "video/webm" },
    { recorderType: "video/webm;codecs=vp8", contentType: "video/webm" },
    { recorderType: "video/webm", contentType: "video/webm" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.recorderType)) ?? null;
}

export type Recording = { blob: Blob; contentType: Format["contentType"]; durationS: number; track: TrackPoint[] };

export type RecorderState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording"; elapsedS: number; fixes: number; accuracyM: number | null; gpsError: string | null }
  | { phase: "done"; recording: Recording }
  | { phase: "error"; message: string };

/**
 * Records the walk video with the back camera and the GPS track at the same
 * time. Track times are ms since recording started, matching the video.
 */
export function useWalkRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const track = useRef<TrackPoint[]>([]);
  const startedAt = useRef(0);
  const gps = useRef<{ accuracyM: number | null; error: string | null }>({ accuracyM: null, error: null });
  const preview = useRef<HTMLVideoElement | null>(null);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (preview.current) preview.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, [release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    const format = pickFormat();
    if (!format) {
      setState({ phase: "error", message: "This browser can't record video. Open Locus in Chrome or Safari on your phone." });
      return;
    }
    if (!("geolocation" in navigator)) {
      setState({ phase: "error", message: "This browser can't share your location, which the walk needs." });
      return;
    }
    setState({ phase: "starting" });
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      console.error("[walk] camera failed", err);
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setState({
        phase: "error",
        message: denied ? "Camera permission is off. Allow the camera for this site and try again." : `Couldn't open the camera: ${(err as Error).message}`,
      });
      return;
    }
    if (preview.current) {
      preview.current.srcObject = stream.current;
      await preview.current.play().catch((err: Error) => console.error("[walk] preview play failed", err));
    }

    track.current = [];
    gps.current = { accuracyM: null, error: null };
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current, { mimeType: format.recorderType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = (e) => {
      console.error("[walk] recorder error", e);
      release();
      setState({ phase: "error", message: "Recording stopped unexpectedly. Try again." });
    };
    rec.onstop = () => {
      const durationS = (Date.now() - startedAt.current) / 1000;
      release();
      setState({
        phase: "done",
        recording: { blob: new Blob(chunks, { type: format.contentType }), contentType: format.contentType, durationS, track: [...track.current] },
      });
    };

    startedAt.current = Date.now();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        gps.current = { accuracyM: pos.coords.accuracy, error: null };
        track.current.push({
          t: Math.max(0, pos.timestamp - startedAt.current),
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        console.error("[walk] GPS error", err);
        gps.current = {
          accuracyM: gps.current.accuracyM,
          error: err.code === err.PERMISSION_DENIED ? "Location permission is off" : "Waiting for GPS",
        };
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    rec.start(1000);
    timer.current = setInterval(() => {
      const elapsedS = (Date.now() - startedAt.current) / 1000;
      if (elapsedS >= MAX_RECORD_S) rec.stop();
      setState({ phase: "recording", elapsedS, fixes: track.current.length, accuracyM: gps.current.accuracyM, gpsError: gps.current.error });
    }, 250);
    setState({ phase: "recording", elapsedS: 0, fixes: 0, accuracyM: null, gpsError: null });
  }, [release]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, start, stop, reset, preview };
}
