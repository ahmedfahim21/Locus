import { describe, expect, it } from "vitest";
import type { WalkProposal } from "../src/domain/types.js";
import type { VisionLandmark } from "../src/enrich/vision.js";
import { RoadGraph } from "../src/geo/roadGraph.js";
import { planRoute } from "../src/onboarding/routePlan.js";
import type { StreetImagery, StreetLook } from "../src/onboarding/streetView.js";
import { draftText, streetLooks } from "../src/onboarding/suggest.js";
import { recipient, setup } from "./fixtures.js";

// MG Road runs east; 1st Cross goes north off it; 2nd Lane turns right (east) to the door.
const ENTRY = { lat: 13.0, lon: 77.002 };
const CORNER = { lat: 13.001, lon: 77.002 };
const DOOR = { lat: 13.001, lon: 77.0025 };
const graph = new RoadGraph([
  { osmId: "w-mg", name: "MG Road", highway: "primary", nodes: [{ id: "m0", location: { lat: 13.0, lon: 77.0 } }, { id: "e", location: ENTRY }, { id: "m1", location: { lat: 13.0, lon: 77.004 } }] },
  { osmId: "w-1c", name: "1st Cross", highway: "residential", nodes: [{ id: "e", location: ENTRY }, { id: "c", location: CORNER }] },
  { osmId: "w-2l", name: "2nd Lane", highway: "residential", nodes: [{ id: "c", location: CORNER }, { id: "d", location: DOOR }] },
]);

describe("planRoute", () => {
  it("starts at the nearest main road, ends at the door, and finds the right turn", () => {
    const route = planRoute(graph, DOOR)!;
    expect(route.entryStreet).toBe("MG Road");
    expect(route.line).toEqual([ENTRY, CORNER, DOOR]);
    expect(route.lengthM).toBeCloseTo(111.2 + 54.2, 0);
    expect(route.turns).toEqual([{ atM: expect.closeTo(111.2, 0), location: CORNER, direction: "right", onto: "2nd Lane" }]);
  });

  it("returns null when no main road is reachable", () => {
    const lanes = new RoadGraph([{ osmId: "w", name: "Lane", highway: "residential", nodes: [{ id: "a", location: CORNER }, { id: "b", location: DOOR }] }]);
    expect(planRoute(lanes, DOOR)).toBeNull();
  });

  it("drafts the instruction from the next turn, the door, or straight on", () => {
    const route = planRoute(graph, DOOR)!;
    expect(draftText("Petrol bunk", 40, route)).toBe("Petrol bunk ke baad right mudiye, 2nd Lane pe.");
    expect(draftText("Neem tree", 130, route)).toBe("Neem tree ke paas hi gate hai, wahin rukiye.");
    const long = { ...route, lengthM: 600, turns: [] };
    expect(draftText("Bakery", 10, long)).toBe("Bakery se seedha aaiye.");
    // A detail from the walk says where the landmark is, then what to do; a trailing full stop isn't doubled.
    expect(draftText("Petrol bunk", 40, route, "laal building ke bagal mein.")).toBe("Petrol bunk, laal building ke bagal mein. Uske baad right mudiye, 2nd Lane pe.");
    expect(draftText("Neem tree", 130, route, "patli gali ke kone pe")).toBe("Neem tree, patli gali ke kone pe. Wahin gate hai, rukiye.");
    expect(draftText("Bakery", 10, long, "petrol pump ke saamne")).toBe("Bakery, petrol pump ke saamne. Wahan se seedha aaiye.");
  });

  it("looks both ways along the route for Street View", () => {
    const route = planRoute(graph, DOOR)!;
    const looks = streetLooks(route);
    expect(looks).toHaveLength(10); // 5 points × left and right
    expect(looks[0]!.heading).toBeCloseTo(270, 0); // heading north: left is west
    expect(looks[1]!.heading).toBeCloseTo(90, 0);
  });
});

class FakeStreet implements StreetImagery {
  calls = 0;
  async images(looks: StreetLook[]) {
    this.calls++;
    return looks.slice(0, 2).map((look) => ({ look, jpeg: Buffer.from([0xff, 0xd8, 0xff]) }));
  }
}

describe("GET /me/suggestions", () => {
  const TOKEN = "tok:owner";
  const temple: VisionLandmark = { frame: 0, name: "Sri Anjaneya Temple", nameHi: "श्री अंजनेय मंदिर", nameLocal: "", aliases: ["Hanuman temple"], kind: "temple", color: "#E08A00", detail: "", box: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
  const gate: VisionLandmark = { frame: 1, name: "Blue gate", nameHi: "नीला गेट", nameLocal: "ನೀಲಿ ಗೇಟ್", aliases: [], kind: "gate", color: "#1F5FBF", detail: "neem ke ped ke saamne", box: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };

  function withProposal(t: ReturnType<typeof setup>) {
    const p: WalkProposal = {
      id: "prp_v", walkId: "walk_1", recipientId: recipient.id, ordinal: 1, name: "Green pharmacy", nameHi: null, nameLocal: null,
      aliases: [], kind: "pharmacy", color: "#2fa56a", detail: "laal building ke bagal mein", location: { lat: 13.0352, lon: 77.5963 }, osmId: null,
      framePath: "frames/rcp_seed/walk_1/1.jpg", atS: 2, status: "proposed",
    };
    t.store.proposals = [p, { ...p, id: "prp_gone", status: "rejected", framePath: null }];
  }

  it("merges map, walk video and Street View along the route, with drafted instructions", async () => {
    const street = new FakeStreet();
    const t = setup({ streetImagery: street });
    t.store.authSubjects.set("owner", recipient.id);
    withProposal(t);
    t.vision.answer = [temple, gate];
    const res = await t.call("GET", "/me/suggestions", undefined, TOKEN);
    expect(res.status).toBe(200);
    const body = res.body as { route: Record<string, unknown>; suggestions: Record<string, unknown>[]; streetView: unknown };
    expect(body.route).toEqual({
      entryStreet: "Bellary Road",
      line: [{ lat: 13.035, lon: 77.596 }, { lat: 13.0354, lon: 77.5966 }, { lat: 13.0357, lon: 77.5969 }],
      lengthM: 125,
      turns: [],
    });
    expect(body.streetView).toEqual({ status: "ok", found: 2 });
    const byName = Object.fromEntries(body.suggestions.map((s) => [s.name, s]));
    // The OSM temple and the Street View temple are one place, with both sources.
    expect(byName["Sri Anjaneya Temple"]).toEqual({
      id: expect.stringMatching(/^sug_/),
      name: "Sri Anjaneya Temple",
      nameHi: "श्री अंजनेय मंदिर",
      nameLocal: null,
      aliases: ["Hanuman Mandir", "Hanuman temple"],
      kind: "temple",
      color: "#e08a00",
      detail: null,
      location: { lat: 13.0354, lon: 77.5966 },
      alongM: 79,
      sources: ["map", "street"],
      osmId: "node/101",
      proposalId: null,
      photoUrl: null,
      text: "Sri Anjaneya Temple ke paas hi gate hai, wahin rukiye.",
      recommended: true,
    });
    expect(byName["Green pharmacy"]).toMatchObject({ sources: ["video"], proposalId: "prp_v", photoUrl: "https://storage.test/frames/rcp_seed/walk_1/1.jpg?exp=3600", color: "#2fa56a", detail: "laal building ke bagal mein" });
    // The walk's detail goes into the drafted line: where it is first, then what to do.
    expect(byName["Green pharmacy"]!.text).toMatch(/^Green pharmacy, laal building ke bagal mein\. /);
    expect(byName["Blue gate"]).toMatchObject({ sources: ["street"], kind: "gate", color: "#1f5fbf", nameLocal: "ನೀಲಿ ಗೇಟ್", detail: "neem ke ped ke saamne" });
    // The bakery and the far mall aren't on the way.
    expect(Object.keys(byName).sort()).toEqual(["Blue gate", "Green pharmacy", "Sri Anjaneya Temple"]);
    // Route order.
    const along = body.suggestions.map((s) => s.alongM as number);
    expect(along).toEqual([...along].sort((a, b) => a - b));

    // Cached: the second request doesn't look at Street View again.
    await t.call("GET", "/me/suggestions", undefined, TOKEN);
    expect(street.calls).toBe(1);
  });

  it("offers every walk landmark the recipient kept, pre-selected, even far from the drafted road route", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    const base = { walkId: "walk_1", recipientId: recipient.id, nameHi: null, nameLocal: null, aliases: [], color: null, detail: null, osmId: null, atS: 1, status: "proposed" as const };
    // GPS between tall buildings: ~110 m north of the route, nine landmarks within 90 m of each other.
    t.store.proposals = Array.from({ length: 9 }, (_, i) => ({
      ...base, id: `prp_${i}`, ordinal: i + 1, name: `Walk landmark ${i + 1}`, kind: "building",
      location: { lat: 13.0364, lon: 77.5962 + i * 0.0001 }, framePath: `frames/rcp_seed/walk_1/${i + 1}.jpg`,
    }));
    const res = await t.call("GET", "/me/suggestions", undefined, TOKEN);
    const walk = (res.body.suggestions as { proposalId: string | null; recommended: boolean }[]).filter((s) => s.proposalId);
    expect(walk.map((s) => s.proposalId).sort()).toEqual(t.store.proposals.map((p) => p.id).sort());
    expect(walk.every((s) => s.recommended)).toBe(true);
  });

  it("reaches further for big places set back from the road", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    t.store.features.push(
      // ~60 m off the route: a tech park counts, a tea stall doesn't.
      { osmId: "way/park", name: "Cyber Towers", altNames: [], kind: "commercial", location: { lat: 13.0352, lon: 77.5970 } },
      { osmId: "node/tea", name: "Raju Tea Stall", altNames: [], kind: "cafe", location: { lat: 13.0352, lon: 77.59705 } },
    );
    const res = await t.call("GET", "/me/suggestions", undefined, TOKEN);
    const names = (res.body as { suggestions: { name: string }[] }).suggestions.map((s) => s.name);
    expect(names).toContain("Cyber Towers");
    expect(names).not.toContain("Raju Tea Stall");
  });

  it("works for a door that isn't saved yet, without Street View when there's no key", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    t.store.homes = [];
    const res = await t.call("GET", "/me/suggestions?lat=13.0357&lon=77.5969", undefined, TOKEN);
    expect(res.status).toBe(200);
    expect((res.body as { streetView: unknown }).streetView).toEqual({ status: "off" });
    expect((res.body as { suggestions: { name: string; sources: string[] }[] }).suggestions.map((s) => [s.name, s.sources])).toEqual([
      ["Sri Anjaneya Temple", ["map"]],
    ]);
  });

  it("reports a Street View failure and retries it next time instead of caching", async () => {
    const street = new FakeStreet();
    street.images = async () => {
      street.calls++;
      throw new Error("Street View REQUEST_DENIED: key not enabled");
    };
    const t = setup({ streetImagery: street });
    t.store.authSubjects.set("owner", recipient.id);
    const res = await t.call("GET", "/me/suggestions", undefined, TOKEN);
    expect((res.body as { streetView: unknown }).streetView).toEqual({ status: "error", message: "Street View REQUEST_DENIED: key not enabled" });
    await t.call("GET", "/me/suggestions", undefined, TOKEN);
    expect(street.calls).toBe(2);
  });

  it("explains when there's no road data or the query is wrong", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    t.store.ways = [];
    expect((await t.call("GET", "/me/suggestions", undefined, TOKEN)).body).toEqual({
      error: { code: "NO_ROAD_DATA", message: "No mapped road reaches this gate yet. Add landmarks yourself, or move the pin onto your lane." },
    });
    expect((await t.call("GET", "/me/suggestions?lat=abc&lon=1", undefined, TOKEN)).status).toBe(400);
    expect((await t.call("GET", "/me/suggestions", undefined, "tok:nobody")).status).toBe(404);
  });

  it("keeps a map suggestion's source, kind and colour when saved", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    const home = {
      handoffPoint: { lat: 13.0357, lon: 77.5969 },
      cues: [{ landmark: "Sri Anjaneya Temple", text: "Mandir ke paas gate hai.", location: { lat: 13.0354, lon: 77.5966 }, source: "map", kind: "temple", color: "#E08A00" }],
    };
    expect((await t.call("PUT", "/me/home", home, TOKEN)).status).toBe(200);
    expect(t.store.homes.find((h) => h.recipientId === recipient.id)!.cues[0]).toMatchObject({ source: "map", kind: "temple", color: "#e08a00", photoPath: null });
  });
});

describe("planRoute without road types", () => {
  it("treats a long named road as the main road when no road has a type", () => {
    const untyped = new RoadGraph([
      { osmId: "w-long", name: "Long Road", highway: null, nodes: [{ id: "m0", location: { lat: 13.0, lon: 76.998 } }, { id: "e", location: ENTRY }, { id: "m1", location: { lat: 13.0, lon: 77.006 } }] },
      { osmId: "w-1c", name: "1st Cross", highway: null, nodes: [{ id: "e", location: ENTRY }, { id: "c", location: CORNER }] },
      { osmId: "w-2l", name: "2nd Lane", highway: null, nodes: [{ id: "c", location: CORNER }, { id: "d", location: DOOR }] },
    ]);
    const route = planRoute(untyped, DOOR)!;
    expect(route.entryStreet).toBe("Long Road");
    expect(route.line).toEqual([ENTRY, CORNER, DOOR]);
    expect(route.turns.map((t) => t.direction)).toEqual(["right"]);
  });
});

describe("routing and reach for real neighbourhoods", () => {
  it("never routes a scooter down a footpath", () => {
    const withPath = new RoadGraph([
      ...[
        { osmId: "w-mg", name: "MG Road", highway: "primary", nodes: [{ id: "m0", location: { lat: 13.0, lon: 77.0 } }, { id: "e", location: ENTRY }, { id: "m1", location: { lat: 13.0, lon: 77.004 } }] },
        { osmId: "w-1c", name: "1st Cross", highway: "residential", nodes: [{ id: "e", location: ENTRY }, { id: "c", location: CORNER }] },
        { osmId: "w-2l", name: "2nd Lane", highway: "residential", nodes: [{ id: "c", location: CORNER }, { id: "d", location: DOOR }] },
      ],
      // A shortcut footpath straight from the main road to the door.
      { osmId: "w-path", name: null, highway: "footway", nodes: [{ id: "m1", location: { lat: 13.0, lon: 77.004 } }, { id: "d", location: DOOR }] },
    ]);
    expect(planRoute(withPath, DOOR)!.line).toEqual([ENTRY, CORNER, DOOR]);
  });
});
