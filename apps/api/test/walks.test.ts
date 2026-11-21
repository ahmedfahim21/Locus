import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPIRED_WALK_ERROR, sweepWalkVideos } from "../src/enrich/sweep.js";
import type { VisionLandmark } from "../src/enrich/vision.js";
import { T0, recipient, setup } from "./fixtures.js";

const TOKEN = "tok:walker";
const profile = { firstName: "Priya", platforms: ["swiggy"], fallbackNote: "Guard ko de dijiye", phone: "+919811111111" };

// Bakery (node/102) → temple (node/101) → gate, as in the fixture OSM data. 186 m in 6 s.
const BAKERY = { lat: 13.0345, lon: 77.5975 };
const TEMPLE = { lat: 13.0354, lon: 77.5966 };
const GATE = { lat: 13.0357, lon: 77.5969 };
const track = [
  { t: 0, ...BAKERY, accuracyM: 5 },
  { t: 2000, lat: 13.2, lon: 77.9, accuracyM: 120 }, // a bad fix far away; must be ignored
  { t: 4499, ...TEMPLE, accuracyM: 6 },
  { t: 6000, ...GATE, accuracyM: 4 },
];
const walkBody = { contentType: "video/mp4", durationS: 6, sizeBytes: 1000, track };

const bakery: VisionLandmark = {
  frame: 2,
  name: "Iyengar bakery",
  nameHi: "अयंगर बेकरी",
  nameKn: "ಅಯ್ಯಂಗಾರ್ ಬೇಕರಿ",
  aliases: ["Iyengar Bakery & Sweets"],
  kind: "food",
  color: "#B8401C",
};
const temple: VisionLandmark = {
  frame: 13,
  name: "Hanuman temple",
  nameHi: "हनुमान मंदिर",
  nameKn: "ಹನುಮಾನ್ ದೇವಸ್ಥಾನ",
  aliases: ["Anjaneya temple"],
  kind: "temple",
  color: "",
};

let dir: string;
let video: Buffer;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "locus-walk-test-"));
  const file = join(dir, "walk.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=10", "-c:v", "mpeg4", file]);
  video = readFileSync(file);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function signedUp() {
  const t = setup();
  expect((await t.call("PUT", "/me/profile", profile, TOKEN)).status).toBe(200);
  return t;
}

/** Creates a walk, uploads the video like the browser does, and processes it. */
async function processedWalk(t: Awaited<ReturnType<typeof signedUp>>, answer: VisionLandmark[]) {
  t.vision.answer = answer;
  const created = await t.call("POST", "/me/walks", walkBody, TOKEN);
  const walkId = (created.body.walk as { id: string }).id;
  const upload = created.body.upload as { path: string; token: string };
  t.storage.browserUpload(upload.token, video, "video/mp4");
  expect((await t.call("POST", `/me/walks/${walkId}/process`, undefined, TOKEN)).status).toBe(202);
  await t.settle();
  return { walkId, upload };
}

describe("walks: create and upload", () => {
  it("records the track and hands out a one-time upload for a private path", async () => {
    const t = await signedUp();
    const res = await t.call("POST", "/me/walks", walkBody, TOKEN);
    expect(res).toEqual({
      status: 201,
      body: {
        walk: { id: "walk_2", status: "awaitingUpload", error: null, createdAt: T0.toISOString(), processedAt: null },
        upload: { path: "walks/rcp_1/walk_2.mp4", token: "upl_1" },
      },
    });
    expect(t.store.walks).toEqual([
      {
        id: "walk_2",
        recipientId: "rcp_1",
        videoPath: "walks/rcp_1/walk_2.mp4",
        contentType: "video/mp4",
        durationS: 6,
        track,
        status: "awaitingUpload",
        error: null,
        createdAt: T0,
        processedAt: null,
        videoDeletedAt: null,
      },
    ]);
    expect(t.storage.uploadTokens.get("upl_1")).toBe("walks/rcp_1/walk_2.mp4");
  });

  it("refuses walks it can't use, before handing out an upload", async () => {
    const t = await signedUp();
    const cases: [unknown, string][] = [
      [{ ...walkBody, track: [track[0]] }, "No GPS track: turn on location and record again"],
      [{ ...walkBody, durationS: 400 }, "Keep the walk under 3 minutes"],
      [{ ...walkBody, sizeBytes: 60 * 1024 * 1024 }, "The video is over 50 MB. Record a shorter walk."],
      [{ ...walkBody, track: track.map((p) => ({ ...p, lat: 51.5, lon: -0.12 })) }, "The walk's GPS track is outside India"],
    ];
    for (const [body, message] of cases) {
      expect(await t.call("POST", "/me/walks", body, TOKEN)).toEqual({ status: 400, body: { error: { code: "INVALID_BODY", message } } });
    }
    const badType = await t.call("POST", "/me/walks", { ...walkBody, contentType: "image/gif" }, TOKEN);
    expect(badType.status).toBe(400);
    expect(t.store.walks).toEqual([]);
    expect(t.storage.uploadTokens.size).toBe(0);
  });

  it("needs a profile first", async () => {
    const t = setup();
    expect(await t.call("POST", "/me/walks", walkBody, TOKEN)).toEqual({
      status: 404,
      body: { error: { code: "PROFILE_NOT_SET_UP", message: "Save your profile first" } },
    });
  });
});

describe("walks: processing", () => {
  it("turns the video into landmark proposals snapped to OSM, keeps one frame each, and deletes the video", async () => {
    const t = await signedUp();
    const duplicate = { ...temple, frame: 15, name: "hanuman Temple" };
    const outOfRange = { ...bakery, frame: 99, name: "Ghost shop" };
    const { walkId, upload } = await processedWalk(t, [temple, bakery, duplicate, outOfRange]);

    // The model saw 19 frames, ~10 m apart, as JPEGs; the bad GPS fix was ignored.
    const shown = t.vision.seen[0]!;
    expect(shown).toHaveLength(19);
    expect(shown.map((f) => f.index)).toEqual([...Array(19).keys()]);
    for (const f of shown) expect(f.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(shown[18]!.distanceM).toBeCloseTo(186.3, 0);
    expect(shown[1]!.distanceM - shown[0]!.distanceM).toBeCloseTo(10.35, 1);

    const res = await t.call("GET", `/me/walks/${walkId}`, undefined, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.walk).toEqual({
      id: walkId,
      status: "ready",
      error: null,
      createdAt: T0.toISOString(),
      processedAt: T0.toISOString(),
    });
    const proposals = res.body.proposals as Record<string, unknown>[];
    expect(proposals).toEqual([
      {
        id: "prp_3",
        ordinal: 1,
        name: "Iyengar bakery",
        nameHi: "अयंगर बेकरी",
        nameKn: "ಅಯ್ಯಂಗಾರ್ ಬೇಕರಿ",
        // The OSM name ("Iyengar Bakery") is the same as the proposal's, so it isn't repeated.
        aliases: ["Iyengar Bakery & Sweets"],
        kind: "food",
        // Lower-cased; the temple had no clear colour.
        color: "#b8401c",
        location: { lat: 13.0345, lon: 77.5975 },
        osmId: "node/102",
        atS: expect.closeTo(0.67, 1),
        status: "proposed",
        photoUrl: `https://storage.test/frames/rcp_1/${walkId}/1.jpg?exp=3600`,
      },
      {
        id: "prp_4",
        ordinal: 2,
        name: "Hanuman temple",
        nameHi: "हनुमान मंदिर",
        nameKn: "ಹನುಮಾನ್ ದೇವಸ್ಥಾನ",
        // "Hanuman Mandir" normalises to the proposal's own name, so only the new names are added.
        aliases: ["Anjaneya temple", "Sri Anjaneya Temple"],
        kind: "temple",
        color: null,
        location: TEMPLE,
        osmId: "node/101",
        atS: expect.closeTo(4.33, 1),
        status: "proposed",
        photoUrl: `https://storage.test/frames/rcp_1/${walkId}/2.jpg?exp=3600`,
      },
    ]);

    // Frames kept as JPEGs, video gone, walk marked done.
    expect([...t.storage.objects.keys()].sort()).toEqual([`frames/rcp_1/${walkId}/1.jpg`, `frames/rcp_1/${walkId}/2.jpg`]);
    expect(t.storage.objects.get(`frames/rcp_1/${walkId}/1.jpg`)!.contentType).toBe("image/jpeg");
    expect(t.storage.objects.has(upload.path)).toBe(false);
    const stored = t.store.walks[0]!;
    expect(stored).toMatchObject({ status: "ready", error: null, processedAt: T0, videoDeletedAt: T0 });
    expect(t.logs).toContainEqual(expect.objectContaining({ event: "walk.vision_dropped", walkId, dropped: 1 }));
    expect(t.logs).toContainEqual(expect.objectContaining({ event: "walk.ready", walkId, frames: 19, proposals: 2, snapped: 2 }));
  });

  it("drops a Hindi or Kannada name written in the wrong script", async () => {
    const t = await signedUp();
    const { walkId } = await processedWalk(t, [{ ...bakery, nameHi: "ಐಯಂಗಾರ್ बेकरी", nameKn: "Iyengar" }]);
    const [p] = (await t.call("GET", `/me/walks/${walkId}`, undefined, TOKEN)).body.proposals as { nameHi: string | null; nameKn: string | null }[];
    expect([p!.nameHi, p!.nameKn]).toEqual([null, null]);
  });

  it("keeps a landmark at its GPS position when no OSM place nearby has that name", async () => {
    const t = await signedUp();
    const { walkId } = await processedWalk(t, [{ ...bakery, name: "Blue gate", aliases: ["neela gate", "Sharma house gate"], kind: "gate", color: "blue" }]);
    const res = await t.call("GET", `/me/walks/${walkId}`, undefined, TOKEN);
    const [p] = res.body.proposals as { osmId: string | null; location: { lat: number; lon: number }; aliases: string[]; kind: string; color: string | null }[];
    expect(p!.osmId).toBeNull();
    // A colour name instead of a hex code is dropped, not stored.
    expect([p!.kind, p!.color]).toEqual(["gate", null]);
    // "neela gate" is the matcher's synonym for "blue gate", so it adds nothing and is dropped.
    expect(p!.aliases).toEqual(["Sharma house gate"]);
    // Frame 2 is ~20.7 m along the first stretch, between the bakery and the temple.
    expect(p!.location.lat).toBeCloseTo(13.0345 + 0.0009 * (20.7 / 139.7), 5);
    expect(p!.location.lon).toBeCloseTo(77.5975 - 0.0009 * (20.7 / 139.7), 5);
  });

  it("records a walk where GPS barely moved as failed, with advice, and allows a retry", async () => {
    const t = await signedUp();
    t.vision.answer = [bakery];
    const still = track.map((p) => ({ ...p, lat: BAKERY.lat, lon: BAKERY.lon, accuracyM: 5 }));
    const created = await t.call("POST", "/me/walks", { ...walkBody, track: still }, TOKEN);
    const walkId = (created.body.walk as { id: string }).id;
    t.storage.browserUpload((created.body.upload as { token: string }).token, video, "video/mp4");
    await t.call("POST", `/me/walks/${walkId}/process`, undefined, TOKEN);
    await t.settle();

    const res = await t.call("GET", `/me/walks/${walkId}`, undefined, TOKEN);
    expect(res.body).toEqual({
      walk: {
        id: walkId,
        status: "failed",
        error: "The GPS track only moved 0 m. Start at the main road and walk to your door while recording.",
        createdAt: T0.toISOString(),
        processedAt: T0.toISOString(),
      },
      proposals: [],
    });
    expect(t.vision.seen).toHaveLength(0);
    // The video stays so a retry can run; a failed walk can be processed again.
    expect(t.storage.objects.has(`walks/rcp_1/${walkId}.mp4`)).toBe(true);
    expect((await t.call("POST", `/me/walks/${walkId}/process`, undefined, TOKEN)).status).toBe(202);
    await t.settle();
  });

  it("records vision failures and missing uploads as failed, without leftover frames", async () => {
    const t = await signedUp();
    t.vision.error = new Error("model unavailable");
    const { walkId } = await processedWalk(t, [bakery]);
    expect((await t.call("GET", `/me/walks/${walkId}`, undefined, TOKEN)).body.walk).toMatchObject({
      status: "failed",
      error: "Processing failed: model unavailable",
    });
    expect([...t.storage.objects.keys()]).toEqual([`walks/rcp_1/${walkId}.mp4`]);
    expect(t.logs).toContainEqual(expect.objectContaining({ event: "walk.failed", walkId, message: "model unavailable" }));

    const created = await t.call("POST", "/me/walks", walkBody, TOKEN);
    const neverUploaded = (created.body.walk as { id: string }).id;
    await t.call("POST", `/me/walks/${neverUploaded}/process`, undefined, TOKEN);
    await t.settle();
    expect((await t.call("GET", `/me/walks/${neverUploaded}`, undefined, TOKEN)).body.walk).toMatchObject({
      status: "failed",
      error: `Processing failed: Object not found: walks/rcp_1/${neverUploaded}.mp4`,
    });
  });

  it("won't process a walk twice, and hides walks from other recipients", async () => {
    const t = await signedUp();
    const { walkId } = await processedWalk(t, [bakery]);
    expect(await t.call("POST", `/me/walks/${walkId}/process`, undefined, TOKEN)).toEqual({
      status: 409,
      body: { error: { code: "WALK_ALREADY_PROCESSED", message: "This walk is already ready" } },
    });
    await t.call("PUT", "/me/profile", { ...profile, firstName: "Ravi" }, "tok:other");
    for (const [method, path] of [["GET", `/me/walks/${walkId}`], ["POST", `/me/walks/${walkId}/process`]] as const) {
      expect(await t.call(method, path, undefined, "tok:other")).toEqual({
        status: 404,
        body: { error: { code: "WALK_NOT_FOUND", message: "Walk not found" } },
      });
    }
  });
});

describe("walks: keeping landmarks", () => {
  it("a kept proposal gives its cue the photo and every name; the rest are rejected and their frames deleted", async () => {
    const t = await signedUp();
    const { walkId } = await processedWalk(t, [bakery, temple]);
    const home = {
      handoffPoint: GATE,
      cues: [
        { text: "Mandir se left lijiye.", landmark: "Hanuman mandir", location: TEMPLE, proposalId: "prp_4", aliases: ["Bajrang Bali mandir"] },
        { text: "Neela gate.", landmark: "blue gate", location: GATE },
      ],
    };
    const saved = await t.call("PUT", "/me/home", home, TOKEN);
    expect(saved.status).toBe(200);
    const frame = `frames/rcp_1/${walkId}/2.jpg`;
    expect((saved.body.home as { cues: unknown[] }).cues).toEqual([
      {
        text: "Mandir se left lijiye.",
        landmark: "Hanuman mandir",
        location: TEMPLE,
        // "Hanuman temple" and "Hanuman Mandir" are the landmark's own name once normalised.
        aliases: ["Bajrang Bali mandir", "हनुमान मंदिर", "ಹನುಮಾನ್ ದೇವಸ್ಥಾನ", "Anjaneya temple", "Sri Anjaneya Temple"],
        source: "walkVideo",
        photoUrl: `https://storage.test/${frame}?exp=3600`,
        kind: "temple",
        color: null,
        proposalId: "prp_4",
      },
      {
        text: "Neela gate.",
        landmark: "blue gate",
        location: GATE,
        aliases: ["blue gate हिं", "blue gate ಕನ್ನ"],
        source: "typed",
        photoUrl: null,
        kind: null,
        color: null,
        proposalId: null,
      },
    ]);
    expect(t.store.homes.find((h) => h.recipientId === "rcp_1")!.cues[0]).toMatchObject({ photoPath: frame, source: "walkVideo" });

    // Only the kept frame survives; the skipped proposal is rejected and points at no frame.
    expect([...t.storage.objects.keys()]).toEqual([frame]);
    expect(t.store.proposals.map((p) => [p.id, p.status, p.framePath])).toEqual([
      ["prp_3", "rejected", null],
      ["prp_4", "kept", frame],
    ]);
    // Everything else about the proposals is unchanged.
    expect(t.store.proposals[1]).toMatchObject({ name: "Hanuman temple", osmId: "node/101", ordinal: 2 });

    const me = await t.call("GET", "/me", undefined, TOKEN);
    expect((me.body.home as { cues: unknown[] }).cues[0]).toMatchObject({ photoUrl: `https://storage.test/${frame}?exp=3600`, proposalId: "prp_4" });

    // A rejected proposal can't come back.
    const again = await t.call("PUT", "/me/home", { ...home, cues: [{ ...home.cues[1], proposalId: "prp_3" }] }, TOKEN);
    expect(again).toEqual({
      status: 400,
      body: { error: { code: "PROPOSAL_UNAVAILABLE", message: 'The photo for "blue gate" is no longer available. Remove it or add it again.' } },
    });
    expect([...t.storage.objects.keys()]).toEqual([frame]);

    // Dropping the landmark later deletes its photo too.
    await t.call("PUT", "/me/home", { ...home, cues: [home.cues[1]] }, TOKEN);
    expect([...t.storage.objects.keys()]).toEqual([]);
    expect(t.store.proposals.map((p) => [p.id, p.status, p.framePath])).toEqual([
      ["prp_3", "rejected", null],
      ["prp_4", "rejected", null],
    ]);
  });

  it("guides a rider who says a landmark's alias", async () => {
    const t = setup();
    t.store.homes[0]!.cues[1]!.aliases = ["Bajrang Bali gudi"];
    await t.startSession();
    await t.say("ses_1", "Ahmed ka Swiggy order");
    await t.say("ses_1", "Bajrang Bali gudi ke paas hoon");
    expect(t.store.turns.at(-1)).toMatchObject({ matchedCueId: "cue_2", lost: false });
    expect(recipient.id).toBe("rcp_seed");
  });
});

describe("walks: video sweep", () => {
  it("deletes videos older than a day that were never processed, and marks those walks failed", async () => {
    const t = await signedUp();
    const created = await t.call("POST", "/me/walks", walkBody, TOKEN);
    const stale = (created.body.walk as { id: string }).id;
    t.storage.browserUpload((created.body.upload as { token: string }).token, video, "video/mp4");
    const { walkId: done } = await processedWalk(t, [bakery]);

    // Not yet a day old: nothing is touched.
    expect(await sweepWalkVideos({ store: t.store, storage: t.storage, now: () => new Date(T0.getTime() + 23 * 3600_000), log: () => {} })).toBe(0);
    expect(t.storage.objects.has(`walks/rcp_1/${stale}.mp4`)).toBe(true);

    const later = new Date(T0.getTime() + 25 * 3600_000);
    const logs: Record<string, unknown>[] = [];
    expect(await sweepWalkVideos({ store: t.store, storage: t.storage, now: () => later, log: (e) => logs.push(e) })).toBe(1);
    expect(t.storage.objects.has(`walks/rcp_1/${stale}.mp4`)).toBe(false);
    expect(t.store.walks.find((w) => w.id === stale)).toMatchObject({ status: "failed", error: EXPIRED_WALK_ERROR, videoDeletedAt: later });
    // The processed walk and its frame are untouched.
    expect(t.store.walks.find((w) => w.id === done)).toMatchObject({ status: "ready", videoDeletedAt: T0 });
    expect(t.storage.objects.has(`frames/rcp_1/${done}/1.jpg`)).toBe(true);
    expect(logs).toEqual([{ event: "walk.sweep", deleted: 1 }]);
  });
});

describe("photos instead of a walk", () => {
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`photo-${n}`)]);
  const gateForm = (photos: Buffer[], extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("lat", String(GATE.lat));
    form.set("lon", String(GATE.lon));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    photos.forEach((p, i) => form.append("photo", new Blob([new Uint8Array(p)], { type: "image/jpeg" }), `p${i}.jpg`));
    return form;
  };
  async function upload(t: Awaited<ReturnType<typeof signedUp>>, form: FormData, token = TOKEN) {
    const res = await t.app.request("/me/photos", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const blueGate: VisionLandmark = { frame: 1, name: "Blue gate", nameHi: "नीला गेट", nameKn: "ನೀಲಿ ಗೇಟ್", aliases: ["neela gate"], kind: "gate", color: "#1F5FBF" };

  it("turns photos into proposals, placing known places from the map and the rest at the gate", async () => {
    const t = await signedUp();
    t.vision.answer = [{ ...bakery, frame: 0 }, blueGate];
    const res = await upload(t, gateForm([jpeg(0), jpeg(1)]));
    expect(res).toEqual({
      status: 202,
      body: { walk: { id: "walk_2", status: "processing", error: null, createdAt: T0.toISOString(), processedAt: null } },
    });
    await t.settle();

    expect(t.vision.seen[0]!.map((f) => [f.index, f.label, f.jpeg.toString()])).toEqual([
      [0, "Photo 0", jpeg(0).toString()],
      [1, "Photo 1", jpeg(1).toString()],
    ]);
    const got = await t.call("GET", "/me/walks/walk_2", undefined, TOKEN);
    expect(got.body).toEqual({
      walk: { id: "walk_2", status: "ready", error: null, createdAt: T0.toISOString(), processedAt: T0.toISOString() },
      proposals: [
        {
          id: "prp_3", ordinal: 1, name: "Iyengar bakery", nameHi: "अयंगर बेकरी", nameKn: "ಅಯ್ಯಂಗಾರ್ ಬೇಕರಿ",
          aliases: ["Iyengar Bakery & Sweets"], kind: "food", color: "#b8401c",
          // Found by name on the map: placed at the mapped bakery.
          location: { lat: 13.0345, lon: 77.5975 }, osmId: "node/102", atS: 0, status: "proposed",
          photoUrl: "https://storage.test/frames/rcp_1/walk_2/1.jpg?exp=3600",
        },
        {
          id: "prp_4", ordinal: 2, name: "Blue gate", nameHi: "नीला गेट", nameKn: "ನೀಲಿ ಗೇಟ್",
          // "neela gate" is the matcher's synonym for the name itself, so it adds nothing.
          aliases: [], kind: "gate", color: "#1f5fbf",
          // Not on the map: starts at the gate for the recipient to move.
          location: GATE, osmId: null, atS: 1, status: "proposed",
          photoUrl: "https://storage.test/frames/rcp_1/walk_2/2.jpg?exp=3600",
        },
      ],
    });
    expect(t.storage.objects.get("frames/rcp_1/walk_2/2.jpg")!.bytes).toEqual(jpeg(1));
    // No video to sweep, and keeping a photo landmark works like a walk one.
    expect(t.store.walks[0]).toMatchObject({ contentType: "image/jpeg", track: [], videoDeletedAt: T0 });
    const saved = await t.call("PUT", "/me/home", { handoffPoint: GATE, cues: [{ landmark: "Blue gate", text: "Neela gate pe rukiye.", location: GATE, proposalId: "prp_4" }] }, TOKEN);
    expect((saved.body.home as { cues: Record<string, unknown>[] }).cues[0]).toMatchObject({ source: "walkVideo", kind: "gate", color: "#1f5fbf", proposalId: "prp_4" });
  });

  it("records a failed read on the walk, keeps no frames, and asks for the photos again", async () => {
    const t = await signedUp();
    t.vision.error = new Error("model unavailable");
    await upload(t, gateForm([jpeg(0)]));
    await t.settle();
    expect((await t.call("GET", "/me/walks/walk_2", undefined, TOKEN)).body.walk).toMatchObject({
      status: "failed",
      error: "Couldn't read the photos: model unavailable. Add them again.",
    });
    expect([...t.storage.objects.keys()]).toEqual([]);
    expect(await t.call("POST", "/me/walks/walk_2/process", undefined, TOKEN)).toEqual({
      status: 409,
      body: { error: { code: "PHOTOS_NOT_KEPT", message: "Photos aren't kept after a failed try. Add them again." } },
    });
  });

  it("refuses what it can't use, before reading anything", async () => {
    const t = await signedUp();
    const cases: [FormData, string][] = [
      [gateForm([]), "Add at least one photo"],
      [gateForm(Array.from({ length: 9 }, (_, i) => jpeg(i))), "Up to 8 photos at a time"],
      [gateForm([Buffer.from("GIF89a")]), '"p0.jpg" isn\'t a JPEG image'],
      [(() => { const f = gateForm([jpeg(0)]); f.delete("lat"); return f; })(), "lat and lon of your gate are required"],
      [gateForm([jpeg(0)], { lat: "51.5", lon: "-0.12" }), "Your gate is outside India"],
    ];
    for (const [form, message] of cases) {
      expect(await upload(t, form)).toEqual({ status: 400, body: { error: { code: "INVALID_BODY", message } } });
    }
    expect(t.store.walks).toEqual([]);
    expect(t.vision.seen).toEqual([]);
    expect((await upload(t, gateForm([jpeg(0)]), "tok:nobody")).status).toBe(404);
  });
});
