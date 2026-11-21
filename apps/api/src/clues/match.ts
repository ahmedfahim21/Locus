import { phonetic, similarity, skeleton, tokens } from "./normalize.js";

export type Candidate = {
  id: string;
  kind: "cue" | "feature";
  names: string[];
};

export type MatchResult = { candidate: Candidate; coverage: number; matchedTokens: number };

const TOKEN_THRESHOLD = 0.8;

/**
 * Words too common to identify a place on their own. A match needs at least
 * one heard token outside this set, so "gali mein hoon" can't match a cue.
 */
const WEAK_TOKENS = new Set([
  "lane", "road", "shop", "circle", "gate", "house", "ghar", "building", "colony", "layout",
  "nagar", "stage", "phase", "block", "street", "second", "first", "third", "1st", "2nd", "3rd",
]);

/** Skeletons are only trusted for longer words, so short ones ("ram", "room") can't collide. */
const SKELETON_MIN_TOKEN = 4;
const SKELETON_MIN = 3;

function sameSkeleton(a: string, b: string): boolean {
  if (a.length < SKELETON_MIN_TOKEN || b.length < SKELETON_MIN_TOKEN) return false;
  const sa = skeleton(a);
  return sa.length >= SKELETON_MIN && sa === skeleton(b);
}

function tokenHeard(nameToken: string, heard: string[]): boolean {
  return heard.some(
    (h) =>
      similarity(nameToken, h) >= TOKEN_THRESHOLD ||
      similarity(phonetic(nameToken), phonetic(h)) >= TOKEN_THRESHOLD ||
      sameSkeleton(nameToken, h),
  );
}

/** Best coverage of any of the candidate's names by the heard tokens. */
function score(candidate: Candidate, heard: string[]): { coverage: number; matchedTokens: number } {
  let best = { coverage: 0, matchedTokens: 0 };
  for (const name of candidate.names) {
    const nameTokens = tokens(name);
    if (nameTokens.length === 0) continue;
    const matched = nameTokens.filter((t) => tokenHeard(t, heard));
    if (!matched.some((t) => !WEAK_TOKENS.has(t))) continue;
    const s = { coverage: matched.length / nameTokens.length, matchedTokens: matched.length };
    if (s.coverage > best.coverage || (s.coverage === best.coverage && s.matchedTokens > best.matchedTokens)) {
      best = s;
    }
  }
  return best;
}

/**
 * Fast path (P9): match a rider's utterance to a cue or nearby feature by name,
 * without the LLM. Candidates are ranked by how much of their name was heard
 * (then by how many tokens). A tie at the top is ambiguous and returns null so
 * the caller can fall back to the LLM, except that a cue beats a feature that
 * names the same place.
 */
export function matchUtterance(utterance: string, candidates: Candidate[]): MatchResult | null {
  const heard = tokens(utterance);
  if (heard.length === 0) return null;

  const scored = candidates
    .map((candidate) => ({ candidate, ...score(candidate, heard) }))
    .filter((r) => r.matchedTokens > 0)
    .sort((a, b) => b.coverage - a.coverage || b.matchedTokens - a.matchedTokens);

  const top = scored[0];
  if (!top) return null;
  const tied = scored.filter((r) => r.coverage === top.coverage && r.matchedTokens === top.matchedTokens);
  if (tied.length === 1) return top;
  const cues = tied.filter((r) => r.candidate.kind === "cue");
  return cues.length === 1 ? cues[0]! : null;
}

/**
 * Heard tokens plus each pair of neighbours joined: speech-to-text often splits
 * one name into two words ("rama krishna", "fil dos").
 */
function withJoinedPairs(heard: string[]): string[] {
  return [...heard, ...heard.slice(1).map((t, i) => heard[i]! + t)];
}

/** True if every token of any of the phrases was heard (fuzzy), allowing a word split in two. */
export function heardAny(utterance: string, phrases: string[]): boolean {
  const heard = withJoinedPairs(tokens(utterance));
  return phrases.some((p) => {
    const pt = tokens(p);
    return pt.length > 0 && pt.every((t) => tokenHeard(t, heard));
  });
}
