import { describe, expect, it } from "vitest";
import { candidatesFor, passesGate, scoreArm } from "../src/eval/ablation.js";
import { home as fixtureHome } from "./fixtures.js";
import { cleanTrack, MAX_FRAMES, sampleAlongTrack, WalkError } from "../src/enrich/track.js";
import { heardAny, matchUtterance } from "../src/clues/match.js";
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

describe("walk track sampling", () => {
  const fix = (t: number, lat: number, lon: number, accuracyM = 5) => ({ t, lat, lon, accuracyM });

  it("drops imprecise fixes, sorts by time, and needs two good ones", () => {
    const track = [fix(2000, 13.001, 77.5), fix(1000, 13.2, 77.9, 200), fix(0, 13.0, 77.5)];
    expect(cleanTrack(track)).toEqual([fix(0, 13.0, 77.5), fix(2000, 13.001, 77.5)]);
    expect(() => cleanTrack([fix(0, 13, 77.5), fix(1, 13.1, 77.5, 80)])).toThrow(WalkError);
  });

  it("caps a long walk at 24 frames spread evenly, inside the video", () => {
    // ~1.1 km straight north over 60 s, but the video is only 30 s long.
    const samples = sampleAlongTrack([fix(0, 13.0, 77.5), fix(60_000, 13.01, 77.5)], 30);
    expect(samples).toHaveLength(MAX_FRAMES);
    expect(samples[0]).toEqual({ atS: 0, location: { lat: 13.0, lon: 77.5 }, distanceM: 0 });
    expect(samples.at(-1)!.distanceM).toBeCloseTo(1111.95, 1);
    expect(samples.at(-1)!.location.lat).toBeCloseTo(13.01, 6);
    expect(Math.max(...samples.map((s) => s.atS))).toBeCloseTo(29.9, 6);
    const gaps = samples.slice(1).map((s, i) => s.distanceM - samples[i]!.distanceM);
    for (const g of gaps) expect(g).toBeCloseTo(1111.95 / 23, 1);
  });

  it("samples every ~10 m on a short walk and refuses one that never moved", () => {
    const samples = sampleAlongTrack([fix(0, 13.0, 77.5), fix(10_000, 13.0005, 77.5)], 10);
    expect(samples).toHaveLength(6); // 55.6 m → floor(5.56) + 1
    expect(samples[3]!.atS).toBeCloseTo(6, 1);
    expect(() => sampleAlongTrack([fix(0, 13.0, 77.5), fix(5000, 13.00001, 77.5)], 5)).toThrow(
      "The GPS track only moved 1 m. Start at the main road and walk to your door while recording.",
    );
  });
});

describe("matching ablation", () => {
  const home = structuredClone(fixtureHome);
  home.cues[1] = { ...home.cues[1]!, source: "walkVideo", aliases: ["Bajrang Bali gudi"] };
  const features = [
    { osmId: "node/102", name: "Iyengar Bakery", altNames: [], kind: "bakery", location: { lat: 13.0345, lon: 77.5975 } },
  ];
  const phrases = [
    { text: "petrol pump ke paas", expected: "cue_1" },
    { text: "Iyengar bakery ke saamne", expected: "node/102" },
    { text: "Bajrang Bali gudi", expected: "cue_2" },
    { text: "kuch samajh nahi aa raha", expected: "lost" },
  ];
  const nobody = { resolve: async () => null };

  it("each arm sees only its own candidates", () => {
    const ids = (arm: "typed" | "osm" | "full") => candidatesFor(arm, home, features).map((c) => [c.id, c.names]);
    expect(ids("typed")).toEqual([["cue_1", ["Shell petrol pump"]], ["cue_3", ["blue gate"]]]);
    expect(ids("osm")).toEqual([["cue_1", ["Shell petrol pump"]], ["cue_3", ["blue gate"]], ["node/102", ["Iyengar Bakery"]]]);
    expect(ids("full")).toEqual([
      ["cue_1", ["Shell petrol pump"]],
      ["cue_2", ["Hanuman temple", "Bajrang Bali gudi"]],
      ["cue_3", ["blue gate"]],
      ["node/102", ["Iyengar Bakery"]],
    ]);
  });

  it("accuracy rises as geography and walk landmarks are added", async () => {
    const run = (arm: "typed" | "osm" | "full") => scoreArm(arm, phrases, candidatesFor(arm, home, features), nobody);
    const [typed, osm, full] = await Promise.all([run("typed"), run("osm"), run("full")]);
    expect([typed.accuracy, osm.accuracy, full.accuracy]).toEqual([0.5, 0.75, 1]);
    expect(typed.results.map((r) => r.got)).toEqual(["cue_1", "lost", "lost", "lost"]);
    expect(full).toMatchObject({ falseCueMatches: 0, viaLlm: 1 });
    expect([passesGate(typed), passesGate(full)]).toEqual([false, true]);
  });

  it("counts a wrong landmark named to the rider as a false match", async () => {
    const wrong = { resolve: async () => "cue_3" };
    const r = await scoreArm("typed", [{ text: "kuch samajh nahi aa raha", expected: "lost" }], candidatesFor("typed", home, features), wrong);
    expect(r).toMatchObject({ accuracy: 0, falseCueMatches: 1, viaLlm: 1 });
  });
});

describe("heardAny: names split by speech-to-text", () => {
  it("matches a name heard as two words, and still rejects a different name", () => {
    expect(heardAny("Rama krishna ke liye hai", ["Ramakrishna"])).toBe(true);
    expect(heardAny("fil dos ke liye, Swiggy se", ["FilDOS"])).toBe(true);
    expect(heardAny("Ramesh ke liye hai", ["Ramakrishna"])).toBe(false);
    expect(heardAny("frill dose ke liye", ["Priya"])).toBe(false);
  });
});

describe("matching Devanagari speech-to-text output", () => {
  it("hears names and apps that Sarvam wrote in Devanagari", () => {
    expect(tokens("अहमद के लिए है स्विगी से")).toEqual(["ahamad", "lie", "svigee"]);
    expect(heardAny("अहमद के लिए है स्विगी से", ["Ahmed"])).toBe(true);
    expect(heardAny("अहमद के लिए है स्विगी से", ["swiggy"])).toBe(true);
    expect(heardAny("ज़ोमैटो से", ["zomato"])).toBe(true);
    expect(heardAny("रमेश के लिए", ["Ahmed"])).toBe(false);
  });

  it("matches a landmark heard in Devanagari, without matching unrelated short words", () => {
    const candidates = [
      { id: "cue_itc", kind: "cue" as const, names: ["ITC Kohenur"] },
      { id: "cue_kc", kind: "cue" as const, names: ["Knowledge City"] },
    ];
    expect(matchUtterance("ITC कोहेनूर के पास हो", candidates)?.candidate.id).toBe("cue_itc");
    expect(heardAny("room mein hoon", ["Ram"])).toBe(false);
    expect(heardAny("medical ke paas", ["model"])).toBe(false);
  });
});
