/**
 * Matching eval (P8): how well rider phrases map to the right cue or nearby place.
 * Usage: pnpm --filter @locus/api eval <recipientId> [path=eval/phrases.jsonl] [--resolver=sarvam|openai]
 *
 * Each line of the phrases file: {"text": "...", "expected": "<cueId|osmId|lost>"}.
 * Runs the real path: name match first, OpenAI only when that finds nothing.
 * Demo gate: accuracy ≥ 85% and zero false cue matches. Exits 1 if the gate fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SEARCH_RADIUS_M } from "../app.js";
import { matchUtterance, type Candidate } from "../clues/match.js";
import { env } from "../config.js";
import { createResolver, type ResolverProvider } from "../guide/createResolver.js";
import { PostgresStore } from "../store/postgres.js";

const GATE_ACCURACY = 0.85;
const phrase = z.object({ text: z.string().min(1), expected: z.string().min(1) }).strict();

const [recipientId, pathArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!recipientId) throw new Error("Usage: eval <recipientId> [phrases.jsonl]");
const path = pathArg ?? fileURLToPath(new URL("../../../../eval/phrases.jsonl", import.meta.url));
const phrases = readFileSync(path, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l, i) => {
    const parsed = phrase.safeParse(JSON.parse(l));
    if (!parsed.success) throw new Error(`${path}:${i + 1}: ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  });
if (phrases.length === 0) throw new Error(`${path} has no phrases`);

const store = new PostgresStore(env("DATABASE_URL"));
const providerArg = process.argv.find((a) => a.startsWith("--resolver="))?.slice("--resolver=".length);
if (providerArg !== undefined && providerArg !== "sarvam" && providerArg !== "openai") {
  throw new Error(`--resolver must be sarvam or openai, got ${providerArg}`);
}
const { resolver, provider, model } = createResolver(() => {}, providerArg as ResolverProvider | undefined);
try {
  const home = await store.getHomeProfile(recipientId);
  if (!home) throw new Error(`Recipient ${recipientId} has no home profile`);
  const features = await store.nearbyFeatures(home.handoffPoint, SEARCH_RADIUS_M);
  const candidates: Candidate[] = [
    ...home.cues.map((c) => ({ id: c.id, kind: "cue" as const, names: [c.landmark] })),
    ...features.map((f) => ({ id: f.osmId, kind: "feature" as const, names: [f.name, ...f.altNames] })),
  ];
  const cueIds = new Set(home.cues.map((c) => c.id));

  let correct = 0;
  let falseCueMatches = 0;
  let viaLlm = 0;
  for (const p of phrases) {
    const fast = matchUtterance(p.text, candidates);
    if (!fast) viaLlm++;
    const got = (fast ? fast.candidate.id : await resolver.resolve(p.text, candidates)) ?? "lost";
    const ok = got === p.expected;
    if (ok) correct++;
    if (!ok && cueIds.has(got)) falseCueMatches++;
    console.log(`${ok ? "ok  " : "MISS"}  expected=${p.expected} got=${got} ${fast ? "(name)" : "(llm)"}  "${p.text}"`);
  }
  const accuracy = correct / phrases.length;
  console.log(
    `\nresolver=${provider} model=${model} phrases=${phrases.length} accuracy=${(accuracy * 100).toFixed(1)}% falseCueMatches=${falseCueMatches} viaLlm=${viaLlm}`,
  );
  const pass = accuracy >= GATE_ACCURACY && falseCueMatches === 0;
  console.log(pass ? "GATE: pass" : "GATE: fail (needs ≥ 85% and zero false cue matches)");
  process.exitCode = pass ? 0 : 1;
} finally {
  await store.close();
}
