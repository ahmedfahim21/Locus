import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/clues/match.js";
import { OpenAIResolver } from "../src/guide/openaiResolver.js";
import { RESOLVER_INSTRUCTIONS } from "../src/guide/resolver.js";

const candidates: Candidate[] = [
  { id: "cue_1", kind: "cue", names: ["Shell petrol pump"] },
  { id: "way/1133460475", kind: "feature", names: ["Knowledge Park Tower 2"] },
];

/** The resolver with its OpenAI client replaced by one that records the request and answers `reply`. */
function resolverAnswering(reply: unknown) {
  const requests: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const r = new OpenAIResolver("sk-test", "gpt-test", (e) => logs.push(e));
  (r as unknown as { client: unknown }).client = {
    responses: {
      create: async (req: Record<string, unknown>) => {
        requests.push(req);
        return { output_text: JSON.stringify(reply) };
      },
    },
  };
  return { r, requests, logs };
}

describe("OpenAIResolver", () => {
  it("sends candidates under short labels, constrains the answer to them, and maps it back", async () => {
    const { r, requests, logs } = resolverAnswering({ candidateId: "p2" });
    expect(await r.resolve("doosra tower", candidates)).toBe("way/1133460475");

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.model).toBe("gpt-test");
    expect(req.instructions).toBe(RESOLVER_INSTRUCTIONS);
    expect(JSON.parse(req.input as string)).toEqual({
      riderSaid: "doosra tower",
      candidates: [
        { id: "p1", kind: "cue", names: ["Shell petrol pump"] },
        { id: "p2", kind: "feature", names: ["Knowledge Park Tower 2"] },
      ],
    });
    const schema = (req.text as { format: { schema: { properties: { candidateId: { anyOf: unknown[] } } } } }).format.schema;
    expect(schema.properties.candidateId.anyOf).toEqual([{ type: "string", enum: ["p1", "p2"] }, { type: "null" }]);
    expect(logs).toEqual([expect.objectContaining({ event: "resolver.call", model: "gpt-test", candidateId: "way/1133460475" })]);
  });

  it("returns null when the model can't place the rider", async () => {
    const { r } = resolverAnswering({ candidateId: null });
    expect(await r.resolve("Mindspace ke paas", candidates)).toBeNull();
  });

  it("throws on a label outside the list instead of guessing", async () => {
    const { r } = resolverAnswering({ candidateId: "p7" });
    await expect(r.resolve("x", candidates)).rejects.toThrow("OpenAI returned a label outside the candidate list: p7");
  });
});
