"use client";

import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "locus-theme";
const EVENT = "locus-theme-change";

/** Runs before first paint (inlined in the layout) so a saved theme never flashes. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function readPreference(): ThemePreference {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

export function setPreference(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked (private mode): the choice still applies for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

function effective(): Theme {
  const pref = readPreference();
  if (pref !== "system") return pref;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme in effect (preference, else the system), updating live. Null until mounted. */
export function useTheme(): { theme: Theme | null; preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [preference, setPref] = useState<ThemePreference>("system");
  useEffect(() => {
    const update = () => {
      setTheme(effective());
      setPref(readPreference());
    };
    update();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    window.addEventListener(EVENT, update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return { theme, preference, setPreference };
}
