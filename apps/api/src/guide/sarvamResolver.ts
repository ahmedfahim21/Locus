import { z } from "zod";
import type { Candidate } from "../clues/match.js";
import { labelCandidates, RESOLVER_INSTRUCTIONS, type PositionResolver } from "./resolver.js";

const BASE = "https://api.sarvam.ai";

const INSTRUCTIONS = `${RESOLVER_INSTRUCTIONS}
Reply with JSON only: {"candidateId": "<id, e.g. p3>"} or {"candidateId": null}.`;

const reply = z.object({ candidateId: z.string().nullable() });

/** Sarvam fallback for the guide loop (sarvam-105b via the OpenAI-compatible chat API). */
export class SarvamResolver implements PositionResolver {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  async resolve(utterance: string, candidates: Candidate[]): Promise<string | null> {
    const labelled = labelCandidates(candidates, "Sarvam");
    const started = Date.now();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        reasoning_effort: null,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INSTRUCTIONS },
          {
            role: "user",
            content: JSON.stringify({
              riderSaid: utterance,
              candidates: labelled.payload,
            }),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Sarvam chat returned ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Sarvam chat returned no content");
    const parsed = reply.parse(JSON.parse(content));
    const candidateId = labelled.idFor(parsed.candidateId);
    this.log({ event: "resolver.call", provider: "sarvam", model: this.model, ms: Date.now() - started, candidateId });
    return candidateId;
  }
}
