"use client";

import { useTheme, type ThemePreference } from "../lib/theme";

const OPTIONS: [ThemePreference, string][] = [
  ["system", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];

/** System / light / dark. The map follows it too. */
export function AppearanceSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="segmented" role="group" aria-label="Appearance">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={preference === value} onClick={() => setPreference(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
