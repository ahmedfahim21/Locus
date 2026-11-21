import { env, optionalEnv } from "../config.js";
import { OpenAIResolver } from "./openaiResolver.js";
import type { PositionResolver } from "./resolver.js";
import { SarvamResolver } from "./sarvamResolver.js";

export type ResolverProvider = "sarvam" | "openai";

/** Picks the fallback position resolver from LOCUS_RESOLVER_PROVIDER (default sarvam). */
export function createResolver(
  log: (event: Record<string, unknown>) => void,
  provider: ResolverProvider = resolverProvider(),
): { resolver: PositionResolver; provider: ResolverProvider; model: string } {
  if (provider === "sarvam") {
    const model = env("SARVAM_LLM_MODEL");
    return { resolver: new SarvamResolver(env("SARVAM_API_KEY"), model, log), provider, model };
  }
  const model = env("OPENAI_MODEL");
  return { resolver: new OpenAIResolver(env("OPENAI_API_KEY"), model, log), provider, model };
}

export function resolverProvider(): ResolverProvider {
  const p = optionalEnv("LOCUS_RESOLVER_PROVIDER") ?? "sarvam";
  if (p !== "sarvam" && p !== "openai") throw new Error(`LOCUS_RESOLVER_PROVIDER must be sarvam or openai, got ${p}`);
  return p;
}
