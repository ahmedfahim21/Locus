"use client";

import { useEffect } from "react";

/** Registers /sw.js in production builds (installable PWA + offline page). Dev skips it to avoid stale pages. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("[pwa] service worker registration failed", err));
  }, []);
  return null;
}
