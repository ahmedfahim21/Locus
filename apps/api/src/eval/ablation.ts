import { matchUtterance, type Candidate } from "../clues/match.js";
import type { HomeProfile, OsmFeature } from "../domain/types.js";
import type { PositionResolver } from "../guide/resolver.js";

export type Phrase = { text: string; expected: string };

/**
 * The three arms of the P4 ablation (section 6), each a superset of the last:
 * - typed: the recipient's typed landmarks by name only (what cue-only assistants have)
 * - osm: plus OpenStreetMap places around the home
 * - full: plus walk-video landmarks and every landmark's aliases (what Locus runs)
 */
export type Arm = "typed" | "osm" | "full";
export const ARMS: Arm[] = ["typed", "osm", "full"];

export function candidatesFor(arm: Arm, home: HomeProfile, features: OsmFeature[]): Candidate[] {
  const cues = home.cues
    .filter((c) => arm === "full" || c.source === "typed")
    .map((c) => ({ id: c.id, kind: "cue" as const, names: arm === "full" ? [c.landmark, ...c.aliases] : [c.landmark] }));
  const places = arm === "typed" ? [] : features.map((f) => ({ id: f.osmId, kind: "feature" as const, names: [f.name, ...f.altNames] }));
  return [...cues, ...places];
}

export type PhraseResult = { phrase: Phrase; got: string; ok: boolean; via: "name" | "llm" };
export type ArmResult = { arm: Arm; accuracy: number; falseCueMatches: number; viaLlm: number; results: PhraseResult[] };

/** Scores phrases the way a call does: name match first, the resolver only when that finds nothing. */
export async function scoreArm(arm: Arm, phrases: Phrase[], candidates: Candidate[], resolver: PositionResolver): Promise<ArmResult> {
  const cueIds = new Set(candidates.filter((c) => c.kind === "cue").map((c) => c.id));
  const results: PhraseResult[] = [];
  for (const phrase of phrases) {
    const fast = matchUtterance(phrase.text, candidates);
    const got = (fast ? fast.candidate.id : await resolver.resolve(phrase.text, candidates)) ?? "lost";
    results.push({ phrase, got, ok: got === phrase.expected, via: fast ? "name" : "llm" });
  }
  const correct = results.filter((r) => r.ok).length;
  return {
    arm,
    accuracy: phrases.length ? correct / phrases.length : 0,
    falseCueMatches: results.filter((r) => !r.ok && cueIds.has(r.got)).length,
    viaLlm: results.filter((r) => r.via === "llm").length,
    results,
  };
}

/** Demo gate (P8): at least 85% and no wrong landmark ever named to a rider. */
export const GATE_ACCURACY = 0.85;
export const passesGate = (r: ArmResult) => r.accuracy >= GATE_ACCURACY && r.falseCueMatches === 0;
