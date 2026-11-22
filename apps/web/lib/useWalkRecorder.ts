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
  /** Camera on and GPS warming up; recording starts on the recipient's tap. */
  | { phase: "ready"; accuracyM: number | null; gpsError: string | null }
  | { phase: "recording"; elapsedS: number; fixes: number; accuracyM: number | null; gpsError: string | null }
  | { phase: "done"; recording: Recording }
  | { phase: "error"; message: string };

/** Uploads are capped at 50 MB; stop before, in case the browser ignores the bitrate (iOS may). */
const MAX_BYTES = 46 * 1024 * 1024;
/** A fix this fresh when recording starts is where the walk begins. */
const START_FIX_MAX_AGE_MS = 15_000;
/** Without a new fix for this long, the GPS status goes back to "Waiting for GPS". */
const GPS_STALE_MS = 30_000;

type Fix = { at: number; lat: number; lon: number; accuracyM: number };

/**
 * Records the walk video with the back camera and the GPS track at the same time.
 * `prepare` opens the camera and warms up GPS before recording, so the walk's first
 * metres (the main road) have positions; `start` records. Track times are ms since
 * recording started, matching the video. The screen is kept awake while recording,
 * and leaving the page stops the recording cleanly with what was filmed.
 */
export function useWalkRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const track = useRef<TrackPoint[]>([]);
  const startedAt = useRef(0);
  const recordingNow = useRef(false);
  const lastFix = useRef<Fix | null>(null);
  const gps = useRef<{ accuracyM: number | null; error: string | null }>({ accuracyM: null, error: null });
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const preview = useRef<HTMLVideoElement | null>(null);

  const release = useCallback(() => {
    recordingNow.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (preview.current) preview.current.srcObject = null;
    wakeLock.current?.release().catch((err: Error) => console.error("[walk] wake lock release failed", err));
    wakeLock.current = null;
  }, []);

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, [release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  // Switching apps or locking the phone suspends the camera and GPS: end the walk with what was filmed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && recorder.current?.state === "recording") {
        console.warn("[walk] page hidden while recording; stopping with what was filmed");
        recorder.current.stop();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const prepare = useCallback(async () => {
    if (!pickFormat()) {
      setState({ phase: "error", message: "This browser can't record video. Open Locus in Chrome or Safari on your phone." });
      return;
    }
    if (!("geolocation" in navigator)) {
      setState({ phase: "error", message: "This browser can't share your location, which the walk needs." });
      return;
    }
    if (stream.current) return;
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

    gps.current = { accuracyM: null, error: null };
    lastFix.current = null;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Some browsers stamp fixes on another clock; time them on arrival instead.
        const fix = { at: Date.now(), lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy };
        lastFix.current = fix;
        gps.current = { accuracyM: fix.accuracyM, error: null };
        if (recordingNow.current) {
          track.current.push({ t: Math.max(0, fix.at - startedAt.current), lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          console.error("[walk] location permission denied", err);
          gps.current = { accuracyM: gps.current.accuracyM, error: "Location permission is off" };
          return;
        }
        // Standing still, watchPosition times out with no new position; a recent fix is still good.
        const stale = !lastFix.current || Date.now() - lastFix.current.at > GPS_STALE_MS;
        console.warn("[walk] GPS", err.code === err.TIMEOUT ? "timeout" : "unavailable", { stale, message: err.message });
        if (stale) gps.current = { accuracyM: null, error: "Waiting for GPS" };
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    timer.current = setInterval(() => {
      if (!recordingNow.current) setState({ phase: "ready", accuracyM: gps.current.accuracyM, gpsError: gps.current.error });
    }, 500);
    setState({ phase: "ready", accuracyM: null, gpsError: null });
  }, []);

  const start = useCallback(async () => {
    const format = pickFormat();
    if (!format || !stream.current) {
      setState({ phase: "error", message: "The camera isn't open yet. Go back and try again." });
      return;
    }
    const chunks: Blob[] = [];
    let bytes = 0;
    const rec = new MediaRecorder(stream.current, { mimeType: format.recorderType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      chunks.push(e.data);
      bytes += e.data.size;
      if (bytes >= MAX_BYTES && rec.state === "recording") {
        console.warn("[walk] stopping at the size limit", { bytes });
        rec.stop();
      }
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
    // The walk starts where the phone already is: a fresh warm-up fix is its first point.
    const fix = lastFix.current;
    track.current = fix && startedAt.current - fix.at <= START_FIX_MAX_AGE_MS ? [{ t: 0, lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM }] : [];
    recordingNow.current = true;
    rec.start(1000);
    if ("wakeLock" in navigator) {
      navigator.wakeLock
        .request("screen")
        .then((lock) => (wakeLock.current = lock))
        // Refused in battery saver or by the browser: recording still works, the screen may just dim.
        .catch((err: Error) => console.warn("[walk] screen wake lock refused; the screen may dim while recording", err.message));
    }
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      const elapsedS = (Date.now() - startedAt.current) / 1000;
      if (elapsedS >= MAX_RECORD_S && rec.state === "recording") rec.stop();
      setState({ phase: "recording", elapsedS, fixes: track.current.length, accuracyM: gps.current.accuracyM, gpsError: gps.current.error });
    }, 250);
    setState({ phase: "recording", elapsedS: 0, fixes: track.current.length, accuracyM: gps.current.accuracyM, gpsError: gps.current.error });
  }, [release]);

  const reset = useCallback(() => {
    release();
    setState({ phase: "idle" });
  }, [release]);

  return { state, prepare, start, stop, reset, preview };
}
