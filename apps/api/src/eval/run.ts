/**
 * Matching eval (P8) and the P4 ablation: how well rider phrases map to the right landmark or nearby place.
 * Usage: pnpm --filter @locus/api eval <recipientId> [path=eval/phrases.jsonl] [--resolver=sarvam|openai] [--ablation]
 *
 * Each line of the phrases file: {"text": "...", "expected": "<cueId|osmId|lost>"}.
 * Runs the real path: name match first, the fallback resolver only when that finds nothing.
 * Without --ablation it scores what Locus runs (typed + walk landmarks with aliases + OSM).
 * With --ablation it also scores typed landmarks only, and typed + OSM, on the same phrases.
 * Demo gate: accuracy ≥ 85% and zero false landmark matches on the full arm. Exits 1 if the gate fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SEARCH_RADIUS_M } from "../app.js";
import { env } from "../config.js";
import { createResolver, type ResolverProvider } from "../guide/createResolver.js";
import { PostgresStore } from "../store/postgres.js";
import { ARMS, candidatesFor, passesGate, scoreArm, type Arm } from "./ablation.js";

const phrase = z.object({ text: z.string().min(1), expected: z.string().min(1) }).strict();

const [recipientId, pathArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!recipientId) throw new Error("Usage: eval <recipientId> [phrases.jsonl] [--resolver=sarvam|openai] [--ablation]");
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
const arms: Arm[] = process.argv.includes("--ablation") ? ARMS : ["full"];
const { resolver, provider, model } = createResolver(() => {}, providerArg as ResolverProvider | undefined);
try {
  const home = await store.getHomeProfile(recipientId);
  if (!home) throw new Error(`Recipient ${recipientId} has no home profile`);
  const features = await store.nearbyFeatures(home.handoffPoint, SEARCH_RADIUS_M);
  const summary: string[] = [];
  let full = null;
  for (const arm of arms) {
    const result = await scoreArm(arm, phrases, candidatesFor(arm, home, features), resolver);
    console.log(`\n== ${arm}`);
    for (const r of result.results) {
      console.log(`${r.ok ? "ok  " : "MISS"}  expected=${r.phrase.expected} got=${r.got} (${r.via})  "${r.phrase.text}"`);
    }
    summary.push(
      `${arm.padEnd(6)} accuracy=${(result.accuracy * 100).toFixed(1)}% falseLandmarkMatches=${result.falseCueMatches} viaFallback=${result.viaLlm}`,
    );
    if (arm === "full") full = result;
  }
  console.log(`\nresolver=${provider} model=${model} phrases=${phrases.length}`);
  for (const line of summary) console.log(line);
  const pass = full !== null && passesGate(full);
  console.log(pass ? "GATE (full): pass" : "GATE (full): fail (needs ≥ 85% and zero false landmark matches)");
  process.exitCode = pass ? 0 : 1;
} finally {
  await store.close();
}
