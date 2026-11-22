import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseVerifier } from "../src/auth/supabaseJwt.js";
import { EXPECTING_DELIVERY_MS } from "../src/domain/types.js";
import { LiveKitTestCalls } from "../src/voice/testCall.js";
import { T0, WEB_ORIGIN, recipient, setup } from "./fixtures.js";

const TOKEN = "tok:google-sub-1";

const profile = {
  firstName: "Priya",
  platforms: ["zomato", "blinkit"],
  fallbackNote: "Leave it with the guard",
  phone: "+919811111111",
};

const homeBody = {
  handoffPoint: { lat: 12.971601, lon: 77.594584 },
  cues: [
    { text: "Take the left after the bakery.", landmark: "Iyengar bakery", location: { lat: 12.9712, lon: 77.594 } },
    { text: "Green gate, second house.", landmark: "green gate", location: { lat: 12.971601, lon: 77.594584 } },
  ],
};

describe("recipient routes: auth", () => {
  it("rejects requests without a valid Supabase token", async () => {
    const t = setup();
    for (const key of [null, "not-a-token"]) {
      const res = await t.call("GET", "/me", undefined, key);
      expect(res).toEqual({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "Sign in again" } } });
    }
  });

  it("an API client key is not a recipient token", async () => {
    const t = setup();
    const res = await t.call("GET", "/me");
    expect(res.status).toBe(401);
  });

  it("answers CORS preflight for the web origin only", async () => {
    const t = setup();
    const res = await t.app.request("/me/profile", {
      method: "OPTIONS",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "PUT" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  });
});

describe("recipient routes: profile, home, switch", () => {
  it("new user has no recipient yet", async () => {
    const t = setup();
    const res = await t.call("GET", "/me", undefined, TOKEN);
    expect(res).toEqual({
      status: 200,
      body: {
        identity: { email: "google-sub-1@example.com", name: "Test User" },
        recipient: null,
        home: null,
        number: null,
        canCallRider: true,
      },
    });
    const off = setup({ phoneCalls: false });
    expect((await off.call("GET", "/me", undefined, TOKEN)).body).toMatchObject({ canCallRider: false });
  });

  it("home and switch need a profile first", async () => {
    const t = setup();
    const home = await t.call("PUT", "/me/home", homeBody, TOKEN);
    expect(home).toEqual({ status: 404, body: { error: { code: "PROFILE_NOT_SET_UP", message: "Save your profile first" } } });
    const sw = await t.call("PUT", "/me/expecting", { on: true }, TOKEN);
    expect(sw.status).toBe(404);
    expect(t.store.recipients).toHaveLength(1);
  });

  it("creates the profile on first save and updates it later without touching other recipients", async () => {
    const t = setup();
    const before = structuredClone(t.store.recipients);
    const res = await t.call("PUT", "/me/profile", profile, TOKEN);
    expect(res).toEqual({ status: 200, body: { recipient: profile } });
    expect(t.store.recipients).toHaveLength(2);
    expect(t.store.recipients[0]).toEqual(before[0]);
    expect(t.store.recipients[1]).toEqual({ id: "rcp_1", ...profile, expectingDeliveryUntil: null });
    expect(t.store.authSubjects.get("google-sub-1")).toBe("rcp_1");

    const update = await t.call("PUT", "/me/profile", { ...profile, fallbackNote: "Ring the bell" }, TOKEN);
    expect(update.status).toBe(200);
    expect(t.store.recipients).toHaveLength(2);
    expect(t.store.recipients[1]).toEqual({ id: "rcp_1", ...profile, fallbackNote: "Ring the bell", expectingDeliveryUntil: null });
  });

  it.each([
    [{ ...profile, phone: "98111" }, "Phone must be E.164, e.g. +919800000000"],
    [{ ...profile, platforms: [] }, "Too small: expected array to have >=1 items"],
  ])("rejects an invalid profile %#", async (body, message) => {
    const t = setup();
    const res = await t.call("PUT", "/me/profile", body, TOKEN);
    expect(res).toEqual({ status: 400, body: { error: { code: "INVALID_BODY", message } } });
    expect(t.store.recipients).toHaveLength(1);
  });

  it("saves the home with ordered cues and a DIGIPIN, and replaces it on re-save", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    const res = await t.call("PUT", "/me/home", homeBody, TOKEN);
    const typed = { source: "typed", photoUrl: null, color: null, proposalId: null };
    // "green gate" says it's a gate; "Iyengar bakery" doesn't name a kind.
    const expectedCues = homeBody.cues.map((c) => ({ ...c, aliases: [`${c.landmark} हिं`, `${c.landmark} ಕನ್ನ`], ...typed, kind: c.landmark === "green gate" ? "gate" : null }));
    const expectedHome = {
      handoffPoint: homeBody.handoffPoint,
      digipin: "4P3JK852C9",
      confirmedAt: T0.toISOString(),
      cues: expectedCues,
    };
    expect(res).toEqual({ status: 200, body: { home: expectedHome, warnings: [] } });
    expect(t.transliterator.calls.sort()).toEqual(["Iyengar bakery", "green gate"]);
    const stored = t.store.homes.find((h) => h.recipientId === "rcp_1")!;
    expect(stored.cues.map((c) => [c.id, c.ordinal, c.landmark])).toEqual([
      ["home_rcp_1_cue_1", 1, "Iyengar bakery"],
      ["home_rcp_1_cue_2", 2, "green gate"],
    ]);

    await t.call("PUT", "/me/home", { ...homeBody, cues: [homeBody.cues[1]!] }, TOKEN);
    // "green gate" kept its name, so its spellings are reused rather than fetched again.
    expect(t.transliterator.calls).toHaveLength(2);
    expect(t.store.homes.filter((h) => h.recipientId === "rcp_1")).toHaveLength(1);
    expect(t.store.homes.find((h) => h.recipientId === "rcp_1")!.cues).toHaveLength(1);
    expect(t.store.homes.find((h) => h.recipientId === recipient.id)).toBeDefined();

    const me = await t.call("GET", "/me", undefined, TOKEN);
    expect(me.body.home).toEqual({ ...expectedHome, cues: [expectedCues[1]] });
  });

  it("names landmarks in the door's state language: Telugu in Hyderabad, Hindi only in Delhi", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    const hyderabad = {
      handoffPoint: { lat: 17.4313762, lon: 78.3821673 },
      cues: [{ text: "Loft ka entrance hai", landmark: "Loft Entrance", location: { lat: 17.4313762, lon: 78.3821673 } }],
    };
    const res = await t.call("PUT", "/me/home", hyderabad, TOKEN);
    expect(res.status).toBe(200);
    expect((res.body.home as { cues: { aliases: string[] }[] }).cues[0]!.aliases).toEqual(["Loft Entrance हिं", "Loft Entrance తెలు"]);
    expect(t.transliterator.languages).toEqual(["te"]);

    const delhi = { handoffPoint: { lat: 28.6139, lon: 77.209 }, cues: [{ ...hyderabad.cues[0]!, location: { lat: 28.6139, lon: 77.209 } }] };
    t.transliterator.failFor = "Loft Entrance";
    const failed = await t.call("PUT", "/me/home", delhi, TOKEN);
    // The Telugu name doesn't fit a Delhi door, so the landmark is spelled again (Hindi only), and the warning says so.
    expect(failed.body.warnings).toEqual(['Couldn\'t add Hindi names for "Loft Entrance". Save again later to retry.']);
    t.transliterator.failFor = null;
    const saved = await t.call("PUT", "/me/home", delhi, TOKEN);
    expect((saved.body.home as { cues: { aliases: string[] }[] }).cues[0]!.aliases).toEqual(["Loft Entrance हिं"]);
    expect(t.transliterator.languages).toEqual(["te", null, null]);
  });

  it("replaces Kannada names with Telugu when a Bengaluru home's door moves to Hyderabad, and keeps everything else", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    await t.call("PUT", "/me/home", homeBody, TOKEN);
    const before = t.store.homes.find((h) => h.recipientId === "rcp_1")!;
    expect(before.cues[1]!.aliases).toEqual(["green gate हिं", "green gate ಕನ್ನ"]);

    const moved = {
      handoffPoint: { lat: 17.4313762, lon: 78.3821673 },
      cues: homeBody.cues.map((c, i) => ({ ...c, location: { lat: 17.4313762 + i * 0.0002, lon: 78.3821673 } })),
    };
    const res = await t.call("PUT", "/me/home", moved, TOKEN);
    expect(res.body.warnings).toEqual([]);
    const after = t.store.homes.find((h) => h.recipientId === "rcp_1")!;
    expect(after.cues.map((c) => [c.landmark, c.text, c.aliases])).toEqual([
      ["Iyengar bakery", homeBody.cues[0]!.text, ["Iyengar bakery हिं", "Iyengar bakery తెలు"]],
      ["green gate", homeBody.cues[1]!.text, ["green gate हिं", "green gate తెలు"]],
    ]);
    expect(t.transliterator.languages).toEqual(["kn", "kn", "te", "te"]);
  });

  it("still saves when spelling fails, and says which names are missing", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    t.transliterator.failFor = "green gate";
    const res = await t.call("PUT", "/me/home", homeBody, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['Couldn\'t add Hindi and Kannada names for "green gate". Save again later to retry.']);
    const cues = (res.body.home as { cues: { landmark: string; aliases: string[] }[] }).cues;
    expect(cues.map((c) => [c.landmark, c.aliases])).toEqual([
      ["Iyengar bakery", ["Iyengar bakery हिं", "Iyengar bakery ಕನ್ನ"]],
      ["green gate", []],
    ]);
    expect(t.logs).toContainEqual(expect.objectContaining({ event: "transliterate.failed", landmark: "green gate" }));

    // Saving again retries only the landmark that has no names yet.
    t.transliterator.failFor = null;
    t.transliterator.calls = [];
    const again = await t.call("PUT", "/me/home", homeBody, TOKEN);
    expect(again.body.warnings).toEqual([]);
    expect(t.transliterator.calls).toEqual(["green gate"]);
  });

  it("rejects a handoff point outside India", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    const res = await t.call("PUT", "/me/home", { ...homeBody, handoffPoint: { lat: 51.5, lon: -0.12 } }, TOKEN);
    expect(res).toEqual({
      status: 400,
      body: { error: { code: "INVALID_BODY", message: "Handoff point is outside India: Latitude out of range" } },
    });
    expect(t.store.homes.find((h) => h.recipientId === "rcp_1")).toBeUndefined();
  });

  it("switch on sets a 3-hour window; off clears it", async () => {
    const t = setup();
    await t.call("PUT", "/me/profile", profile, TOKEN);
    const on = await t.call("PUT", "/me/expecting", { on: true }, TOKEN);
    const until = new Date(T0.getTime() + EXPECTING_DELIVERY_MS);
    expect(on).toEqual({ status: 200, body: { expectingDeliveryUntil: until.toISOString() } });
    expect(t.store.recipients[1]!.expectingDeliveryUntil).toEqual(until);
    expect(t.store.recipients[0]!.expectingDeliveryUntil).toEqual(recipient.expectingDeliveryUntil);

    const off = await t.call("PUT", "/me/expecting", { on: false }, TOKEN);
    expect(off).toEqual({ status: 200, body: { expectingDeliveryUntil: null } });
    expect(t.store.recipients[1]!.expectingDeliveryUntil).toBeNull();
  });
});

describe("recipient routes: calls", () => {
  it("lists only the recipient's own calls with their turns", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    await t.startSession();
    await t.say("ses_1", "Ahmed ka Swiggy order");
    await t.say("ses_1", "petrol pump");

    const res = await t.call("GET", "/me/calls", undefined, "tok:owner");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      calls: [
        {
          id: "ses_1",
          state: "guiding",
          noTranscript: false,
          createdAt: T0.toISOString(),
          endedAt: null,
          message: null,
          reachedCue: 1,
          handoff: null,
          turns: [
            expect.objectContaining({ utterance: "Ahmed ka Swiggy order", lost: false }),
            expect.objectContaining({ utterance: "petrol pump", lost: false }),
          ],
        },
      ],
    });

    const stranger = await t.call("GET", "/me/calls", undefined, "tok:someone-else");
    expect(stranger).toEqual({ status: 200, body: { calls: [] } });
  });
});

describe("recipient routes: route", () => {
  const n = (lat: number, lon: number) => ({ lat, lon });

  it("follows OSM roads from the first landmark to the door, without a duplicate door leg", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    const res = await t.call("GET", "/me/route", undefined, "tok:owner");
    expect(res).toEqual({
      status: 200,
      body: {
        legs: [
          // cue 1 (on node n2) → cue 2 (on n3) along 2nd Cross Road
          { onRoads: true, line: [n(13.035, 77.596), n(13.035, 77.596), n(13.0354, 77.5966), n(13.0354, 77.5966)] },
          // cue 2 → cue 3 (the blue gate, which is the door: no extra leg)
          { onRoads: true, line: [n(13.0354, 77.5966), n(13.0354, 77.5966), n(13.0357, 77.5969), n(13.0357, 77.5969)] },
        ],
      },
    });
  });

  it("marks legs with no road connection as straight lines", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    t.store.ways = [];
    const res = await t.call("GET", "/me/route", undefined, "tok:owner");
    expect(res.body).toEqual({
      legs: [
        { onRoads: false, line: [n(13.035, 77.596), n(13.0354, 77.5966)] },
        { onRoads: false, line: [n(13.0354, 77.5966), n(13.0357, 77.5969)] },
      ],
    });
  });

  it("adds a door leg when the last landmark isn't the door, and rebuilds after the door moves", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    await t.call("GET", "/me/route", undefined, "tok:owner"); // warm the graph cache for the old door
    const moved = {
      handoffPoint: n(13.0357, 77.5969),
      cues: [
        { text: "Bakery se seedha.", landmark: "Iyengar bakery", location: n(13.0345, 77.5975) },
        { text: "Mandir se left.", landmark: "Hanuman temple", location: n(13.0354, 77.5966) },
      ],
    };
    expect((await t.call("PUT", "/me/home", moved, "tok:owner")).status).toBe(200);
    const res = await t.call("GET", "/me/route", undefined, "tok:owner");
    expect(res.body).toEqual({
      legs: [
        { onRoads: true, line: [n(13.0345, 77.5975), n(13.0345, 77.5975), n(13.035, 77.596), n(13.0354, 77.5966), n(13.0354, 77.5966)] },
        { onRoads: true, line: [n(13.0354, 77.5966), n(13.0354, 77.5966), n(13.0357, 77.5969), n(13.0357, 77.5969)] },
      ],
    });
  });

  it("asks for a profile, then a home, before there is a route", async () => {
    const t = setup();
    expect(await t.call("GET", "/me/route", undefined, "tok:nobody")).toEqual({
      status: 404,
      body: { error: { code: "PROFILE_NOT_SET_UP", message: "Save your profile first" } },
    });
    t.store.authSubjects.set("owner", recipient.id);
    t.store.homes = [];
    expect(await t.call("GET", "/me/route", undefined, "tok:owner")).toEqual({
      status: 404,
      body: { error: { code: "HOME_NOT_SET_UP", message: "Save your door and landmarks first" } },
    });
  });
});

describe("createSupabaseVerifier", () => {
  async function keyPair() {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = { ...(await webcrypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "ES256" };
    return { pair, jwk };
  }

  async function sign(privateKey: webcrypto.CryptoKey, payload: object, kid = "k1") {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const input = `${enc({ alg: "ES256", kid, typ: "JWT" })}.${enc(payload)}`;
    const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, Buffer.from(input));
    return `${input}.${Buffer.from(sig).toString("base64url")}`;
  }

  const ISSUER = "https://ref.supabase.co/auth/v1";
  const nowMs = T0.getTime();
  const valid = { sub: "u1", iss: ISSUER, aud: "authenticated", exp: nowMs / 1000 + 600, email: "a@b.c", user_metadata: { full_name: "A B" } };

  async function verifierFor(jwk: object) {
    let fetches = 0;
    const verify = createSupabaseVerifier({
      jwksUrl: "https://ref.supabase.co/auth/v1/.well-known/jwks.json",
      issuer: ISSUER,
      now: () => nowMs,
      fetchFn: (async () => {
        fetches++;
        return new Response(JSON.stringify({ keys: [jwk] }));
      }) as typeof fetch,
    });
    return { verify, fetches: () => fetches };
  }

  it("accepts a valid token and caches the JWKS", async () => {
    const { pair, jwk } = await keyPair();
    const v = await verifierFor(jwk);
    const token = await sign(pair.privateKey, valid);
    expect(await v.verify(token)).toEqual({ sub: "u1", email: "a@b.c", name: "A B" });
    expect(await v.verify(token)).toEqual({ sub: "u1", email: "a@b.c", name: "A B" });
    expect(v.fetches()).toBe(1);
  });

  it.each([
    ["expired", { ...valid, exp: nowMs / 1000 - 1 }],
    ["wrong issuer", { ...valid, iss: "https://evil.example/auth/v1" }],
    ["wrong audience", { ...valid, aud: "anon" }],
    ["no subject", { ...valid, sub: undefined }],
  ])("rejects a token with %s", async (_name, payload) => {
    const { pair, jwk } = await keyPair();
    const v = await verifierFor(jwk);
    expect(await v.verify(await sign(pair.privateKey, payload))).toBeNull();
  });

  it("rejects a token signed by another key, and garbage", async () => {
    const { jwk } = await keyPair();
    const other = await keyPair();
    const v = await verifierFor(jwk);
    expect(await v.verify(await sign(other.pair.privateKey, valid))).toBeNull();
    expect(await v.verify("not.a.jwt")).toBeNull();
    expect(await v.verify("abc")).toBeNull();
  });
});

describe("recipient routes: call the rider", () => {
  it("calls the rider's number, tagged with the recipient", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    const before = structuredClone(t.store.recipients);
    const res = await t.call("POST", "/me/call-rider", { phone: "+919811112222" }, "tok:owner");
    expect(res).toEqual({ status: 200, body: { ringing: true, phone: "+919811112222" } });
    expect(t.phoneCalls.rung).toEqual([{ recipientId: "rcp_seed", phone: "+919811112222" }]);
    expect(t.logs).toContainEqual({ event: "callRider.ringing", recipientId: "rcp_seed", room: "rider-1", ownPhone: false });
    // Calling changes nothing stored, and issues no browser call.
    expect(t.store.recipients).toEqual(before);
    expect(t.testCalls.issued).toEqual([]);
  });

  it("calls the profile phone when no number is given, so the recipient can play the rider", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    expect(await t.call("POST", "/me/call-rider", undefined, "tok:owner")).toEqual({ status: 200, body: { ringing: true, phone: recipient.phone } });
    expect(t.phoneCalls.rung).toEqual([{ recipientId: "rcp_seed", phone: recipient.phone }]);
  });

  it("only dials Indian numbers", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    expect(await t.call("POST", "/me/call-rider", { phone: "+14155550100" }, "tok:owner")).toEqual({
      status: 400,
      body: { error: { code: "INVALID_BODY", message: "Rider's phone must be an Indian number, e.g. +919800000000" } },
    });
    expect(t.phoneCalls.rung).toEqual([]);
  });

  it("calls at most once a minute", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    await t.call("POST", "/me/call-rider", undefined, "tok:owner");
    expect(await t.call("POST", "/me/call-rider", undefined, "tok:owner")).toEqual({
      status: 429,
      body: { error: { code: "CALL_RIDER_TOO_SOON", message: "Locus just called a rider. Try again in a minute" } },
    });
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    expect((await t.call("POST", "/me/call-rider", undefined, "tok:owner")).status).toBe(200);
    expect(t.phoneCalls.rung).toHaveLength(2);
  });

  it("explains what's missing, and calls no one", async () => {
    const t = setup();
    expect((await t.call("POST", "/me/call-rider", undefined, "tok:nobody")).body).toEqual({
      error: { code: "PROFILE_NOT_SET_UP", message: "Save your profile first" },
    });
    t.store.authSubjects.set("owner", recipient.id);
    t.store.recipients[0]!.expectingDeliveryUntil = null;
    expect(await t.call("POST", "/me/call-rider", undefined, "tok:owner")).toEqual({
      status: 409,
      body: { error: { code: "DELIVERY_NOT_EXPECTED", message: 'Turn on "Expecting a delivery" to try a call' } },
    });
    expect(t.phoneCalls.rung).toEqual([]);
  });

  it("answers 503 when the server has no outbound trunk", async () => {
    const t = setup({ phoneCalls: false });
    t.store.authSubjects.set("owner", recipient.id);
    expect(await t.call("POST", "/me/call-rider", undefined, "tok:owner")).toEqual({
      status: 503,
      body: { error: { code: "PHONE_CALL_UNAVAILABLE", message: "Phone calls aren't set up on this server yet" } },
    });
  });
});

describe("recipient routes: test call", () => {
  it("issues a call to the recipient's own Locus, and only theirs", async () => {
    const t = setup();
    t.store.authSubjects.set("owner", recipient.id);
    const res = await t.call("POST", "/me/test-call", undefined, "tok:owner");
    expect(res).toEqual({ status: 200, body: { url: "ws://livekit.test", token: "token-for-rcp_seed", room: "test-1" } });
    expect(t.testCalls.issued).toEqual(["rcp_seed"]);
  });

  it("explains what's missing before issuing anything", async () => {
    const t = setup();
    expect(await t.call("POST", "/me/test-call", undefined, "tok:nobody")).toEqual({
      status: 404,
      body: { error: { code: "PROFILE_NOT_SET_UP", message: "Save your profile first" } },
    });
    t.store.authSubjects.set("owner", recipient.id);
    t.store.recipients[0]!.expectingDeliveryUntil = null;
    expect(await t.call("POST", "/me/test-call", undefined, "tok:owner")).toEqual({
      status: 409,
      body: { error: { code: "DELIVERY_NOT_EXPECTED", message: 'Turn on "Expecting a delivery" to try a call' } },
    });
    t.store.homes = [];
    expect((await t.call("POST", "/me/test-call", undefined, "tok:owner")).body).toEqual({
      error: { code: "HOME_NOT_SET_UP", message: "Save your door and landmarks first" },
    });
    expect(t.testCalls.issued).toEqual([]);
  });

  it("says so when the server has no LiveKit configured", async () => {
    const t = setup({ testCalls: false });
    t.store.authSubjects.set("owner", recipient.id);
    expect(await t.call("POST", "/me/test-call", undefined, "tok:owner")).toEqual({
      status: 503,
      body: { error: { code: "TEST_CALL_UNAVAILABLE", message: "Calls aren't set up on this server yet" } },
    });
  });
});

describe("LiveKitTestCalls", () => {
  it("puts the recipient in a token attribute and dispatches the guide worker", async () => {
    const ticket = await new LiveKitTestCalls("ws://lk.test", "key", "secret-that-is-long-enough-for-hs256").issue("rcp_7");
    const claims = JSON.parse(Buffer.from(ticket.token.split(".")[1]!, "base64url").toString());
    expect(ticket.url).toBe("ws://lk.test");
    expect(ticket.room).toMatch(/^test-/);
    expect(claims.attributes).toEqual({ "locus.recipientId": "rcp_7" });
    expect(claims.video).toMatchObject({ room: ticket.room, roomJoin: true, canPublish: true, canUpdateOwnMetadata: false });
    expect(claims.roomConfig.agents).toEqual([expect.objectContaining({ agentName: "locus-guide" })]);
  });
});
