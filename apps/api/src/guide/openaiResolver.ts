import OpenAI from "openai";
import type { Candidate } from "../clues/match.js";
import { labelCandidates, RESOLVER_INSTRUCTIONS, type PositionResolver } from "./resolver.js";


/** OpenAI fallback for the guide loop. Model is pinned through OPENAI_MODEL and logged with each call. */
export class OpenAIResolver implements PositionResolver {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async resolve(utterance: string, candidates: Candidate[]): Promise<string | null> {
    const labelled = labelCandidates(candidates, "OpenAI");
    const started = Date.now();
    const response = await this.client.responses.create({
      model: this.model,
      instructions: RESOLVER_INSTRUCTIONS,
      input: JSON.stringify({
        riderSaid: utterance,
        candidates: labelled.payload,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "rider_position",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { candidateId: { anyOf: [{ type: "string", enum: labelled.labels }, { type: "null" }] } },
            required: ["candidateId"],
          },
        },
      },
    });
    const parsed = JSON.parse(response.output_text) as { candidateId: string | null };
    const candidateId = labelled.idFor(parsed.candidateId);
    this.log({ event: "resolver.call", model: this.model, ms: Date.now() - started, candidateId });
    return candidateId;
  }
}
