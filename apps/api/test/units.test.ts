import { describe, expect, it } from "vitest";
import { matchUtterance } from "../src/clues/match.js";
import { romanize, tokens } from "../src/clues/normalize.js";
import { decodeDigipin, encodeDigipin } from "../src/digipin/digipin.js";
import { RoadGraph } from "../src/geo/roadGraph.js";
import { inHandoffWindow } from "../src/handoff/loopGuard.js";

describe("DIGIPIN (official India Post vectors)", () => {
  it("encodes the README example", () => {
    expect(encodeDigipin({ lat: 13.11179621, lon: 80.20264269 })).toBe("4T396F42L7");
  });

  it("decodes to the cell centre from the README example", () => {
    const { lat, lon } = decodeDigipin("4P3JK852C9");
    expect(lat.toFixed(6)).toBe("12.971601");
    expect(lon.toFixed(6)).toBe("77.594584");
  });

  it("round-trips: decoding then encoding returns the same code", () => {
    expect(encodeDigipin(decodeDigipin("4P3JK852C9"))).toBe("4P3JK852C9");
  });

  it("rejects out-of-range coordinates and invalid codes", () => {
    expect(() => encodeDigipin({ lat: 40, lon: 77 })).toThrow("Latitude out of range");
    expect(() => encodeDigipin({ lat: 13, lon: 100 })).toThrow("Longitude out of range");
    expect(() => decodeDigipin("4P3-JK8-52C9")).toThrow("Invalid DIGIPIN");
    expect(() => decodeDigipin("4P3JK852C1")).toThrow("Invalid DIGIPIN");
  });
});

describe("normalization", () => {
  it("romanizes Devanagari", () => {
    expect(romanize("हनुमान मंदिर")).toBe("hanumaan mandir");
  });

  it("maps Hinglish place words to canonical tokens and drops fillers", () => {
    expect(tokens("Main Hanuman mandir ke peeche wali gali mein hoon")).toEqual(["hanuman", "temple", "lane"]);
    expect(tokens("petrol bunk ke saamne")).toEqual(["petrolpump"]);
  });
});

describe("matchUtterance", () => {
  const candidates = [
    { id: "a", kind: "feature" as const, names: ["Ganesha Temple"] },
    { id: "b", kind: "feature" as const, names: ["Rama Temple"] },
  ];

  it("returns null when a generic word matches several places", () => {
    expect(matchUtterance("temple ke paas hoon", candidates)).toBeNull();
  });

  it("picks the specific place when its full name is heard", () => {
    expect(matchUtterance("rama temple ke saamne", candidates)?.candidate.id).toBe("b");
  });

  it("never matches on weak words alone", () => {
    const cue = [{ id: "c", kind: "cue" as const, names: ["Second lane behind the temple"] }];
    expect(matchUtterance("gali mein hoon", cue)).toBeNull();
    expect(matchUtterance("second gali", cue)).toBeNull();
  });

  it("matches a cue when only part of its name is heard, if no other place competes", () => {
    const cue = [{ id: "c", kind: "cue" as const, names: ["Shell petrol pump"] }];
    expect(matchUtterance("petrol bunk ke paas", cue)).toMatchObject({ coverage: 0.5, matchedTokens: 1 });
  });

  it("tolerates small spelling differences", () => {
    expect(matchUtterance("ganesh temple", candidates)?.candidate.id).toBe("a");
  });
});

describe("RoadGraph", () => {
  const graph = new RoadGraph([
    {
      osmId: "w1",
      name: "1st Main",
      nodes: [
        { id: "a", location: { lat: 13.0, lon: 77.0 } },
        { id: "b", location: { lat: 13.001, lon: 77.0 } },
      ],
    },
    {
      osmId: "w2",
      name: null,
      nodes: [
        { id: "b", location: { lat: 13.001, lon: 77.0 } },
        { id: "c", location: { lat: 13.001, lon: 77.001 } },
      ],
    },
    { osmId: "w3", name: "Island Road", nodes: [{ id: "x", location: { lat: 13.01, lon: 77.01 } }, { id: "y", location: { lat: 13.0101, lon: 77.01 } }] },
  ]);

  it("names the first named street on the shortest path", () => {
    expect(graph.firstStreet({ lat: 13.0, lon: 77.0 }, { lat: 13.001, lon: 77.001 })).toEqual({
      reachable: true,
      street: "1st Main",
    });
  });

  it("reports unreachable components", () => {
    expect(graph.firstStreet({ lat: 13.0, lon: 77.0 }, { lat: 13.0101, lon: 77.01 })).toEqual({
      reachable: false,
      street: null,
    });
  });
});

describe("handoff window", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  it("is open during the leg and for 60 s after", () => {
    expect(inHandoffWindow(null, start)).toBe(false);
    expect(inHandoffWindow({ startedAt: start, endedAt: null, answered: null }, start)).toBe(true);
    const ended = { startedAt: start, endedAt: start, answered: false };
    expect(inHandoffWindow(ended, new Date(start.getTime() + 59_999))).toBe(true);
    expect(inHandoffWindow(ended, new Date(start.getTime() + 60_000))).toBe(false);
  });
});
