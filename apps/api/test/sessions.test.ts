import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/app.js";
import { say } from "../src/guide/phrases.js";
import { API_KEY, DID, OTHER_KEY, LOCUS_OUTBOUND, T0, home, recipient, setup } from "./fixtures.js";

const cue = (n: 1 | 2 | 3) => home.cues[n - 1]!;

describe("auth", () => {
  it("rejects a missing key and changes nothing", async () => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", { did: DID }, null);
    expect(res).toEqual({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } } });
    expect(t.store.sessions.size).toBe(0);
  });

  it("rejects a wrong key", async () => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", { did: DID }, "not-a-key");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } });
  });
});

describe("POST /v1/sessions", () => {
  it("creates a screening session and gives Locus's worker the call's key terms", async () => {
    const t = setup();
    const res = await t.startSession();
    expect(res).toEqual({
      status: 201,
      body: {
        sessionId: "ses_1",
        state: "screening",
        instruction: say.notice("hi"),
        // Name and apps, landmarks in route order, then nearby places closest first.
        // "Hanuman Mandir" is dropped: it's the same name as "Hanuman temple" to the matcher.
        keyterms: ["Ahmed", "swiggy", "Shell petrol pump", "Hanuman temple", "blue gate", "Sri Anjaneya Temple", "Iyengar Bakery"],
      },
    });
    expect(t.store.sessions.get("ses_1")).toEqual({
      id: "ses_1",
      clientId: "client_worker",
      recipientId: recipient.id,
      callerIdHash: sha256("+919111111111"),
      state: "screening",
      mode: "normal",
      language: "hi",
      currentCue: -1,
      lostTurns: 0,
      screening: { nameHeard: false, platformHeard: false, attempts: 0, objected: false },
      handoff: null,
      message: null,
      createdAt: T0,
      endedAt: null,
    });
    expect(t.store.turns).toEqual([]);
  });

  it("accepts recipientId instead of did and honours the language", async () => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", { recipientId: recipient.id, language: "en" });
    expect(res).toEqual({
      status: 201,
      body: { sessionId: "ses_1", state: "screening", instruction: say.notice("en"), keyterms: expect.arrayContaining(["Ahmed"]) },
    });
    expect(t.store.sessions.get("ses_1")!.callerIdHash).toBeNull();
  });

  it("never gives a third-party client the key terms (they include the screening name)", async () => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", { did: DID }, OTHER_KEY);
    expect(res).toEqual({ status: 201, body: { sessionId: "ses_1", state: "screening", instruction: say.notice("hi") } });
  });

  it.each([
    [{ did: DID, recipientId: recipient.id }, "Provide exactly one of did or recipientId"],
    [{}, "Provide exactly one of did or recipientId"],
  ])("rejects invalid body %j", async (body, message) => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", body);
    expect(res).toEqual({ status: 400, body: { error: { code: "INVALID_BODY", message } } });
    expect(t.store.sessions.size).toBe(0);
  });

  it("hangs up on an unknown number", async () => {
    const t = setup();
    const res = await t.call("POST", "/v1/sessions", { did: "+918000000777" });
    expect(res).toEqual({ status: 404, body: { error: { code: "NUMBER_NOT_SET_UP", message: "This number isn't set up" } } });
  });

  it("rejects calls from Locus's own numbers (loop guard)", async () => {
    const t = setup();
    for (const callerId of [LOCUS_OUTBOUND, DID]) {
      const res = await t.call("POST", "/v1/sessions", { did: DID, callerId });
      expect(res).toEqual({ status: 409, body: { error: { code: "LOOP_REJECTED", message: "Caller is a Locus number" } } });
    }
    expect(t.store.sessions.size).toBe(0);
  });

  it("refuses when the delivery switch is off or expired (server-side, P2/P4)", async () => {
    const t = setup();
    t.store.recipients[0]!.expectingDeliveryUntil = null;
    const off = await t.startSession();
    expect(off).toEqual({
      status: 409,
      body: { error: { code: "DELIVERY_NOT_EXPECTED", message: "Recipient isn't expecting a delivery right now" } },
    });
    t.store.recipients[0]!.expectingDeliveryUntil = new Date(T0.getTime() + 3 * 3600_000);
    t.clock.now = new Date(T0.getTime() + 3 * 3600_000);
    const expired = await t.startSession();
    expect(expired.status).toBe(409);
    expect(expired.body).toEqual(off.body);
    expect(t.store.sessions.size).toBe(0);
  });

  it("refuses when the recipient has no cues", async () => {
    const t = setup();
    t.store.homes = [];
    const res = await t.startSession();
    expect(res).toEqual({ status: 409, body: { error: { code: "HOME_NOT_SET_UP", message: "Recipient has no confirmed cues" } } });
  });
});

describe("screening (P2, P4)", () => {
  it("needs the first name and an app; with only the name, it asks for the app, and three misses take a message", async () => {
    const t = setup();
    await t.startSession();
    const first = await t.say("ses_1", "Ahmed ke liye delivery hai");
    // It asks only for what's missing.
    expect(first).toEqual({ status: 200, body: { instruction: say.askApp("hi"), state: "screening", lostTurns: 0 } });
    const second = await t.say("ses_1", "Ahmed bhai ka order");
    expect(second.body).toMatchObject({ instruction: say.askApp("hi"), state: "screening" });
    const third = await t.say("ses_1", "bas Ahmed");
    expect(third).toEqual({ status: 200, body: { instruction: say.takeMessage("hi"), state: "message", lostTurns: 0 } });
    for (const r of [first, second, third]) {
      for (const c of home.cues) expect(String(r.body.instruction)).not.toContain(c.text);
    }
    const msg = await t.say("ses_1", "Main gate pe chhod raha hoon");
    expect(msg).toEqual({ status: 200, body: { instruction: say.messageThanks("hi"), state: "ended", lostTurns: 0 } });
    const s = t.store.sessions.get("ses_1")!;
    expect(s).toMatchObject({ state: "ended", message: "Main gate pe chhod raha hoon", endedAt: T0 });
    expect(s.screening).toEqual({ nameHeard: true, platformHeard: false, attempts: 3, objected: false });
    expect(t.store.turns.map((x) => x.utterance)).toEqual(["Ahmed ke liye delivery hai", "Ahmed bhai ka order", "bas Ahmed", "Main gate pe chhod raha hoon"]);
  });

  it("with only the app, it asks whose order it is", async () => {
    const t = setup();
    await t.startSession();
    const res = await t.say("ses_1", "Swiggy se hoon");
    expect(res.body).toEqual({ instruction: say.askName("hi"), state: "screening", lostTurns: 0 });
  });

  it("accepts any known delivery app or courier, not only the ones the recipient listed", async () => {
    const t = setup();
    // The fixture recipient lists only Swiggy; a rider from Amazon (or an Ekart courier) still gets through.
    expect(recipient.platforms).not.toContain("amazon");
    await t.startSession();
    expect((await t.say("ses_1", "Ahmed ka Amazon order")).body).toMatchObject({ instruction: say.whereAreYou("hi"), state: "guiding" });
    const t2 = setup();
    await t2.startSession();
    expect((await t2.say("ses_1", "Ekart se hoon, Ahmed ke liye")).body).toMatchObject({ state: "guiding" });
    // "Delivery" alone isn't an app.
    const t3 = setup();
    await t3.startSession();
    expect((await t3.say("ses_1", "Ahmed ke liye delivery hai")).body).toMatchObject({ instruction: say.askApp("hi"), state: "screening" });
  });

  it("a rider asking the way while leaving a message gets one more try at screening", async () => {
    const t = setup();
    await t.startSession();
    for (const text of ["hello", "pata nahi", "kuch nahi"]) await t.say("ses_1", text);
    expect(t.store.sessions.get("ses_1")!.state).toBe("message");
    // "Where do I come?" in Devanagari, as speech-to-text writes it.
    const ask = await t.say("ses_1", "मुझे किधर आना है?");
    expect(ask.body).toEqual({ instruction: say.secondChance("hi"), state: "screening", lostTurns: 0 });
    const ok = await t.say("ses_1", "Ahmed ka Swiggy order");
    expect(ok.body).toMatchObject({ instruction: say.whereAreYou("hi"), state: "guiding" });
  });

  it("the second chance is given once: a second miss goes back to taking a message", async () => {
    const t = setup();
    await t.startSession();
    for (const text of ["hello", "pata nahi", "kuch nahi", "kidhar aana hai"]) await t.say("ses_1", text);
    const miss = await t.say("ses_1", "pata nahi bhai");
    expect(miss.body).toMatchObject({ instruction: say.takeMessage("hi"), state: "message" });
    const again = await t.say("ses_1", "kidhar aana hai");
    expect(again.body).toMatchObject({ instruction: say.messageThanks("hi"), state: "ended" });
  });

  it("name and platform (across two answers) start guidance", async () => {
    const t = setup();
    await t.startSession();
    await t.say("ses_1", "Swiggy se");
    const res = await t.say("ses_1", "Ahmed");
    expect(res).toEqual({ status: 200, body: { instruction: say.whereAreYou("hi"), state: "guiding", lostTurns: 0 } });
    expect(t.store.sessions.get("ses_1")!.screening).toEqual({
      nameHeard: true,
      platformHeard: true,
      attempts: 2,
      objected: false,
    });
  });

  it("an objecting rider who passes screening goes to handoff with no transcript stored", async () => {
    const t = setup();
    await t.startSession();
    const res = await t.say("ses_1", "record mat karo, Ahmed ka Swiggy order hai");
    expect(res).toEqual({ status: 200, body: { instruction: say.connecting("hi"), state: "handoff", lostTurns: 0, handoffPhone: recipient.phone } });
    const s = t.store.sessions.get("ses_1")!;
    expect(s.mode).toBe("noTranscript");
    expect(s.handoff).toEqual({ startedAt: T0, endedAt: null, answered: null });
    expect(t.store.turns).toEqual([]);
  });

  it("an objecting rider who fails screening only gets take-a-message, no handoff", async () => {
    const t = setup();
    await t.startSession();
    await t.say("ses_1", "no recording please");
    await t.say("ses_1", "pata nahi");
    const res = await t.say("ses_1", "kuch nahi");
    expect(res.body).toEqual({ instruction: say.takeMessage("hi"), state: "message", lostTurns: 0 });
    const s = t.store.sessions.get("ses_1")!;
    expect(s.handoff).toBeNull();
    expect(s.mode).toBe("noTranscript");
    expect(t.store.turns).toEqual([]);
  });
});

async function guiding(t: ReturnType<typeof setup>) {
  await t.startSession();
  await t.say("ses_1", "Ahmed ka Swiggy order hai");
  expect(t.store.sessions.get("ses_1")!.state).toBe("guiding");
}

describe("guide loop", () => {
  it("walks the cues by name match without calling OpenAI, then arrives", async () => {
    const t = setup();
    await guiding(t);

    // Each landmark's own text is what Locus says once the rider is there.
    const a = await t.say("ses_1", "main petrol pump ke saamne hoon");
    expect(a.body).toEqual({ instruction: cue(1).text, state: "guiding", lostTurns: 0 });
    expect(t.store.sessions.get("ses_1")!.currentCue).toBe(0);

    // Matches both the cue and the OSM temple's alt name: the cue wins.
    const b = await t.say("ses_1", "hanuman mandir ke paas aa gaya");
    expect(b.body).toEqual({ instruction: cue(2).text, state: "guiding", lostTurns: 0 });

    const c = await t.say("ses_1", "neele gate ke saamne khada hoon");
    expect(c.body).toEqual({ instruction: say.arrived("hi"), state: "arrived", lostTurns: 0 });

    expect(t.resolver.calls).toEqual([]);
    const s = t.store.sessions.get("ses_1")!;
    expect(s).toMatchObject({ state: "arrived", currentCue: 2, endedAt: T0 });
    expect(t.store.turns.slice(-3).map((x) => x.matchedCueId)).toEqual(["cue_1", "cue_2", "cue_3"]);

    const closed = await t.say("ses_1", "hello");
    expect(closed).toEqual({ status: 409, body: { error: { code: "SESSION_CLOSED", message: "Session is arrived" } } });
  });

  it("doesn't arrive at a last landmark short of the door: it guides the last stretch until the rider says they're there", async () => {
    const t = setup();
    // The last landmark ~110 m before the door.
    t.store.homes[0]!.cues[2] = { ...t.store.homes[0]!.cues[2]!, location: { lat: 13.0347, lon: 77.5969 } };
    await guiding(t);
    await t.say("ses_1", "main petrol pump ke saamne hoon");
    await t.say("ses_1", "hanuman mandir ke paas aa gaya");
    const last = await t.say("ses_1", "neele gate ke saamne khada hoon");
    // Its own line (which leads to the door) instead of "you've arrived".
    expect(last.body).toEqual({ instruction: cue(3).text, state: "guiding", lostTurns: 0 });
    expect(t.store.sessions.get("ses_1")).toMatchObject({ state: "guiding", currentCue: 2, endedAt: null });
    const there = await t.say("ses_1", "haan pahunch gaya");
    expect(there.body).toEqual({ instruction: say.arrived("hi"), state: "arrived", lostTurns: 0 });
    expect(t.store.sessions.get("ses_1")).toMatchObject({ state: "arrived", currentCue: 2, endedAt: T0 });
  });

  it("\"pahunch gaya\" before the last landmark isn't arriving", async () => {
    const t = setup();
    await guiding(t);
    await t.say("ses_1", "main petrol pump ke saamne hoon");
    const early = await t.say("ses_1", "pahunch gaya");
    expect(early.body).toMatchObject({ state: "guiding" });
    expect(t.store.sessions.get("ses_1")!.currentCue).toBe(0);
  });

  it("matches Devanagari speech", async () => {
    const t = setup();
    await guiding(t);
    const res = await t.say("ses_1", "मैं हनुमान मंदिर के पास हूँ");
    expect(res.body).toEqual({ instruction: cue(2).text, state: "guiding", lostTurns: 0 });
  });

  it("treats a mapped place standing on a landmark the rider hasn't reached as that landmark", async () => {
    const t = setup();
    await guiding(t);
    // "Sri Anjaneya Temple" (node/101) is the OSM place at the Hanuman temple landmark.
    const res = await t.say("ses_1", "Sri Anjaneya temple ke paas hoon");
    expect(res.body).toEqual({ instruction: cue(2).text, state: "guiding", lostTurns: 0 });
    expect(t.store.turns.at(-1)).toMatchObject({ matchedCueId: "cue_2", matchedOsmId: "node/101", lost: false });
    expect(t.store.sessions.get("ses_1")!.currentCue).toBe(1);
  });

  it("gives an off-route rider a street-name step to rejoin the route at the next landmark, not the nearest (P5)", async () => {
    const t = setup();
    await guiding(t);
    // The bakery is nearer the Hanuman temple (~130 m) than the petrol pump (~170 m), but the route comes in by the pump.
    const res = await t.say("ses_1", "Iyengar bakery ke saamne hoon");
    expect(res.body).toEqual({
      instruction: say.routeStep("hi", "Bellary Road", "Shell petrol pump"),
      state: "guiding",
      lostTurns: 0,
    });
    expect(String(res.body.instruction)).not.toMatch(/\b(left|right|baayen|daayen)\b/i);
    expect(t.store.turns.at(-1)).toMatchObject({ matchedOsmId: "node/102", matchedCueId: null, lost: false });
    // An off-route step doesn't move the rider along the route.
    expect(t.store.sessions.get("ses_1")!.currentCue).toBe(-1);
  });

  it("once past a landmark, rejoins at the one after it", async () => {
    const t = setup();
    await guiding(t);
    await t.say("ses_1", "Shell petrol pump ke paas hoon");
    const res = await t.say("ses_1", "Iyengar bakery ke saamne hoon");
    expect(res.body.instruction).toBe(say.routeStep("hi", "Bellary Road", "Hanuman temple"));
  });

  it("sends a rider who is right beside a later landmark to it, rather than back to the next one", async () => {
    const t = setup();
    // ~35 m from the blue gate (the last landmark): beside it, but not the same place.
    t.store.features.push({ osmId: "node/103", name: "Ganesh Tea Stall", altNames: [], kind: "cafe", location: { lat: 13.0360, lon: 77.5970 } });
    await guiding(t);
    const res = await t.say("ses_1", "Ganesh tea stall ke paas hoon");
    expect(String(res.body.instruction)).toContain("blue gate");
    expect(t.store.turns.at(-1)).toMatchObject({ matchedOsmId: "node/103", matchedCueId: null });
  });

  it("falls back to OpenAI only when the name match finds nothing", async () => {
    const t = setup();
    await guiding(t);
    t.resolver.answer = "cue_1";
    const res = await t.say("ses_1", "jahan gaadiyon mein tel bharte hain wahan hoon");
    expect(res.body).toEqual({ instruction: cue(1).text, state: "guiding", lostTurns: 0 });
    expect(t.resolver.calls).toEqual([
      {
        utterance: "jahan gaadiyon mein tel bharte hain wahan hoon",
        candidateIds: ["cue_1", "cue_2", "cue_3", "node/101", "node/102"],
      },
    ]);
  });

  it("two lost turns (no match, then silence) hand off to the recipient", async () => {
    const t = setup();
    await guiding(t);
    const a = await t.say("ses_1", "kuch samajh nahi aa raha");
    expect(a.body).toEqual({ instruction: say.didntUnderstand("hi"), state: "guiding", lostTurns: 1 });
    t.clock.now = new Date(T0.getTime() + 5000);
    const b = await t.call("POST", "/v1/sessions/ses_1/utterances", { kind: "silence" });
    expect(b.body).toEqual({ instruction: say.connecting("hi"), state: "handoff", lostTurns: 2, handoffPhone: recipient.phone });
    expect(t.store.sessions.get("ses_1")!.handoff).toEqual({
      startedAt: new Date(T0.getTime() + 5000),
      endedAt: null,
      answered: null,
    });
    expect(t.store.turns.slice(-2).map((x) => [x.utterance, x.lost])).toEqual([
      ["kuch samajh nahi aa raha", true],
      [null, true],
    ]);
  });

  it("a match resets the lost-turn count", async () => {
    const t = setup();
    await guiding(t);
    await t.say("ses_1", "kuch nahi dikh raha");
    const res = await t.say("ses_1", "petrol pump");
    expect(res.body).toEqual({ instruction: cue(1).text, state: "guiding", lostTurns: 0 });
  });

  it("counts unsupported language and 'wrong instruction' as lost turns", async () => {
    const t = setup();
    await guiding(t);
    const a = await t.say("ses_1", "petrol bunk hatra iddini", "kn");
    expect(a.body).toEqual({ instruction: say.didntUnderstand("hi"), state: "guiding", lostTurns: 1 });
    const b = await t.say("ses_1", "yeh galat hai, petrol pump nahi mila");
    expect(b.body).toEqual({ instruction: say.connecting("hi"), state: "handoff", lostTurns: 2, handoffPhone: recipient.phone });
    expect(t.resolver.calls).toEqual([]);
  });

  it("asking for a person goes straight to handoff", async () => {
    const t = setup();
    await guiding(t);
    const res = await t.say("ses_1", "unse baat karao please");
    expect(res.body).toEqual({ instruction: say.connecting("hi"), state: "handoff", lostTurns: 0, handoffPhone: recipient.phone });
  });
});

describe("handoff phone (first-party only)", () => {
  it("a third-party client entering handoff never receives the recipient's phone", async () => {
    const t = setup();
    await t.call("POST", "/v1/sessions", { did: DID }, OTHER_KEY);
    await t.call("POST", "/v1/sessions/ses_1/utterances", { kind: "speech", text: "Ahmed ka Swiggy order" }, OTHER_KEY);
    const res = await t.call("POST", "/v1/sessions/ses_1/utterances", { kind: "speech", text: "unse baat karao" }, OTHER_KEY);
    expect(res).toEqual({ status: 200, body: { instruction: say.connecting("hi"), state: "handoff", lostTurns: 0 } });
  });
});

describe("handoff (P3)", () => {
  async function inHandoff(t: ReturnType<typeof setup>) {
    await guiding(t);
    await t.say("ses_1", "unse baat karao");
  }

  it("answered → bridged, leg stays open", async () => {
    const t = setup();
    await inHandoff(t);
    const res = await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: true });
    expect(res).toEqual({ status: 200, body: { instruction: say.connected("hi"), state: "bridged" } });
    expect(t.store.sessions.get("ses_1")!.handoff).toEqual({ startedAt: T0, endedAt: null, answered: true });
  });

  it("unanswered → fallback note, session ends, leg closes", async () => {
    const t = setup();
    await inHandoff(t);
    t.clock.now = new Date(T0.getTime() + 20_000);
    const res = await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: false });
    expect(res).toEqual({
      status: 200,
      body: { instruction: say.fallback("hi", recipient.fallbackNote), state: "ended" },
    });
    const s = t.store.sessions.get("ses_1")!;
    expect(s.handoff).toEqual({ startedAt: T0, endedAt: new Date(T0.getTime() + 20_000), answered: false });
    expect(s.endedAt).toEqual(new Date(T0.getTime() + 20_000));
  });

  it("rejects handoff results outside the handoff state", async () => {
    const t = setup();
    await guiding(t);
    const res = await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: true });
    expect(res).toEqual({ status: 409, body: { error: { code: "NOT_IN_HANDOFF", message: "Session is guiding" } } });
  });

  it("rejects new calls on the DID during the leg and for 60 s after it ends", async () => {
    const t = setup();
    await inHandoff(t);
    const during = await t.startSession({ callerId: "+919222222222" });
    expect(during).toEqual({
      status: 409,
      body: { error: { code: "LOOP_REJECTED", message: "Recipient has an active or recent handoff call" } },
    });
    t.clock.now = new Date(T0.getTime() + 20_000);
    await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: false });
    t.clock.now = new Date(T0.getTime() + 30_000); // 10 s after the leg ended
    expect((await t.startSession()).status).toBe(409);
    t.clock.now = new Date(T0.getTime() + 81_000); // 61 s after
    const later = await t.startSession();
    expect(later.status).toBe(201);
  });

  it("a bridged call closed by the worker lets the next delivery through after the grace period", async () => {
    const t = setup();
    await inHandoff(t);
    await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: true });
    t.clock.now = new Date(T0.getTime() + 5 * 60_000); // rider and recipient hang up; the worker ends the session
    expect(await t.call("POST", "/v1/sessions/ses_1/end")).toEqual({ status: 200, body: { state: "ended" } });
    expect(t.store.sessions.get("ses_1")!.handoff).toEqual({ startedAt: T0, endedAt: t.clock.now, answered: true });
    t.clock.now = new Date(T0.getTime() + 5 * 60_000 + 61_000);
    expect((await t.startSession()).status).toBe(201);
  });

  it("a bridged call whose end was never recorded stops blocking calls after 20 minutes", async () => {
    const t = setup();
    await inHandoff(t);
    await t.call("POST", "/v1/sessions/ses_1/handoff-result", { answered: true });
    t.clock.now = new Date(T0.getTime() + 10 * 60_000);
    expect((await t.startSession()).status).toBe(409);
    t.clock.now = new Date(T0.getTime() + 21 * 60_000 + 1);
    expect((await t.startSession()).status).toBe(201);
  });
});

describe("recording objections, any time in the call", () => {
  it("mid-guidance: says so, blanks what was already stored, and stores nothing after", async () => {
    const t = setup();
    await guiding(t);
    await t.say("ses_1", "main petrol pump ke saamne hoon");
    expect(t.store.turns.some((x) => x.utterance !== null)).toBe(true);
    const res = await t.say("ses_1", "record mat karo");
    expect(res.body).toEqual({ instruction: `${say.notRecording("hi")} ${say.whereAreYou("hi")}`, state: "guiding", lostTurns: 0 });
    expect(t.store.sessions.get("ses_1")).toMatchObject({ mode: "noTranscript", state: "guiding" });
    const stored = t.store.turns.length;
    expect(t.store.turns.every((x) => x.utterance === null)).toBe(true);
    // Guidance carries on; nothing new is written.
    const next = await t.say("ses_1", "hanuman mandir ke paas aa gaya");
    expect(next.body).toMatchObject({ instruction: cue(2).text, state: "guiding" });
    expect(t.store.turns.length).toBe(stored);
  });

  it("while screening: the turns before the objection are blanked too", async () => {
    const t = setup();
    await t.startSession();
    await t.say("ses_1", "Swiggy se");
    await t.say("ses_1", "Ahmed, par record mat karo");
    expect(t.store.sessions.get("ses_1")!.mode).toBe("noTranscript");
    expect(t.store.turns.every((x) => x.utterance === null)).toBe(true);
  });

  it("leaving a message: an objecting rider isn't written down", async () => {
    const t = setup();
    await t.startSession();
    for (const text of ["hello", "pata nahi", "kuch nahi"]) await t.say("ses_1", text);
    expect(t.store.sessions.get("ses_1")!.state).toBe("message");
    await t.say("ses_1", "recording nahi chahiye, bas bol dena main aaya tha");
    expect(t.store.sessions.get("ses_1")).toMatchObject({ state: "ended", mode: "noTranscript", message: null });
    expect(t.store.turns.every((x) => x.utterance === null)).toBe(true);
  });
});

describe("session ownership and end", () => {
  it("another client can't see or drive the session", async () => {
    const t = setup();
    await t.startSession();
    const res = await t.call("POST", "/v1/sessions/ses_1/utterances", { kind: "silence" }, OTHER_KEY);
    expect(res).toEqual({ status: 404, body: { error: { code: "SESSION_NOT_FOUND", message: "Session not found" } } });
    expect(t.store.sessions.get("ses_1")!.screening.attempts).toBe(0);
  });

  it("end closes the session and any open handoff leg", async () => {
    const t = setup();
    await guiding(t);
    await t.say("ses_1", "unse baat karao");
    t.clock.now = new Date(T0.getTime() + 7000);
    const res = await t.call("POST", "/v1/sessions/ses_1/end");
    expect(res).toEqual({ status: 200, body: { state: "ended" } });
    const s = t.store.sessions.get("ses_1")!;
    expect(s.state).toBe("ended");
    expect(s.endedAt).toEqual(new Date(T0.getTime() + 7000));
    expect(s.handoff).toEqual({ startedAt: T0, endedAt: new Date(T0.getTime() + 7000), answered: null });
  });

  it("ending an arrived call keeps it arrived, with its arrival time", async () => {
    const t = setup();
    await guiding(t);
    for (const text of ["main petrol pump ke saamne hoon", "hanuman mandir ke paas aa gaya", "neele gate ke saamne khada hoon"]) await t.say("ses_1", text);
    t.clock.now = new Date(T0.getTime() + 5000);
    const res = await t.call("POST", "/v1/sessions/ses_1/end");
    expect(res).toEqual({ status: 200, body: { state: "arrived" } });
    expect(t.store.sessions.get("ses_1")).toMatchObject({ state: "arrived", endedAt: T0 });
  });

  it("responses never contain the handoff pin or the full cue list", async () => {
    const t = setup();
    const created = await t.startSession();
    await t.say("ses_1", "Ahmed ka Swiggy order");
    const turn = await t.say("ses_1", "petrol pump");
    for (const r of [created, turn]) {
      const json = JSON.stringify(r.body);
      expect(json).not.toContain(String(home.handoffPoint.lat));
      expect(json).not.toContain(home.digipin);
      expect(json).not.toContain(cue(3).text);
    }
    expect(API_KEY).not.toBe(OTHER_KEY);
  });
});

describe("live calls are kept in memory", () => {
  it("a rider's turn reads nothing from the database and still saves the session and the turn", async () => {
    const t = setup();
    await t.startSession();
    const reads = [vi.spyOn(t.store, "getSession"), vi.spyOn(t.store, "getRecipient"), vi.spyOn(t.store, "getHomeProfile")];
    const before = structuredClone(t.store.sessions.get("ses_1")!);
    const res = await t.say("ses_1", "Ahmed ka Swiggy order");
    expect(res).toEqual({ status: 200, body: { instruction: say.whereAreYou("hi"), state: "guiding", lostTurns: 0 } });
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    // Only state and screening changed in the stored session.
    expect(t.store.sessions.get("ses_1")).toEqual({
      ...before,
      state: "guiding",
      screening: { nameHeard: true, platformHeard: true, attempts: 1, objected: false },
    });
    expect(t.store.turns.map((turn) => [turn.sessionId, turn.utterance, turn.instruction])).toEqual([
      ["ses_1", "Ahmed ka Swiggy order", say.whereAreYou("hi")],
    ]);
  });

  it("an ended call is dropped from memory: later turns read it from the database and are refused", async () => {
    const t = setup();
    await t.startSession();
    await t.call("POST", "/v1/sessions/ses_1/end");
    const getSession = vi.spyOn(t.store, "getSession");
    const res = await t.say("ses_1", "hello");
    expect(res).toEqual({ status: 409, body: { error: { code: "SESSION_CLOSED", message: "Session is ended" } } });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(t.store.turns).toEqual([]);
  });

  it("another client still can't drive a call that is in memory", async () => {
    const t = setup();
    await t.startSession();
    const res = await t.call("POST", "/v1/sessions/ses_1/end", undefined, OTHER_KEY);
    expect(res).toEqual({ status: 404, body: { error: { code: "SESSION_NOT_FOUND", message: "Session not found" } } });
    expect(t.store.sessions.get("ses_1")!.state).toBe("screening");
  });
});
