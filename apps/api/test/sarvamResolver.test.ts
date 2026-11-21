import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "../src/clues/match.js";
import { SarvamResolver } from "../src/guide/sarvamResolver.js";

const candidates: Candidate[] = [
  { id: "cue_1", kind: "cue", names: ["Shell petrol pump"] },
  { id: "node/102", kind: "feature", names: ["Iyengar Bakery"] },
];

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  return calls;
}

const chat = (content: string) => ({ choices: [{ message: { content } }] });

afterEach(() => vi.unstubAllGlobals());

describe("SarvamResolver", () => {
  it("sends the utterance and candidates, and returns the chosen id", async () => {
    const calls = stubFetch(200, chat('{"candidateId":"node/102"}'));
    const logs: Record<string, unknown>[] = [];
    const r = new SarvamResolver("sk-test", "sarvam-105b", (e) => logs.push(e));
    expect(await r.resolve("bakery ke paas", candidates)).toBe("node/102");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.sarvam.ai/v1/chat/completions");
    expect(calls[0]!.init.headers).toEqual({ "api-subscription-key": "sk-test", "content-type": "application/json" });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: "sarvam-105b",
      temperature: 0,
      reasoning_effort: null,
      response_format: { type: "json_object" },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual({
      riderSaid: "bakery ke paas",
      candidates: [
        { id: "cue_1", kind: "cue", names: ["Shell petrol pump"] },
        { id: "node/102", kind: "feature", names: ["Iyengar Bakery"] },
      ],
    });
    expect(logs).toEqual([expect.objectContaining({ event: "resolver.call", provider: "sarvam", candidateId: "node/102" })]);
  });

  it("returns null when the model can't place the rider", async () => {
    stubFetch(200, chat('{"candidateId":null}'));
    const r = new SarvamResolver("k", "sarvam-105b", () => {});
    expect(await r.resolve("pata nahi", candidates)).toBeNull();
  });

  it("throws when the model invents an id outside the list", async () => {
    stubFetch(200, chat('{"candidateId":"node/999"}'));
    const r = new SarvamResolver("k", "sarvam-105b", () => {});
    await expect(r.resolve("mall", candidates)).rejects.toThrow("outside the candidate list: node/999");
  });

  it("throws on API errors and malformed replies instead of guessing", async () => {
    stubFetch(429, "rate limited");
    const r = new SarvamResolver("k", "sarvam-105b", () => {});
    await expect(r.resolve("x", candidates)).rejects.toThrow("Sarvam chat returned 429: rate limited");

    stubFetch(200, chat("not json"));
    await expect(r.resolve("x", candidates)).rejects.toThrow();

    stubFetch(200, { choices: [] });
    await expect(r.resolve("x", candidates)).rejects.toThrow("Sarvam chat returned no content");
  });
});
