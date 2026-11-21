import { describe, expect, it } from "vitest";
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
  it("creates a screening session and returns only the spoken notice", async () => {
    const t = setup();
    const res = await t.startSession();
    expect(res).toEqual({
      status: 201,
      body: { sessionId: "ses_1", state: "screening", instruction: say.notice("hi") },
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
    expect(res).toEqual({ status: 201, body: { sessionId: "ses_1", state: "screening", instruction: say.notice("en") } });
    expect(t.store.sessions.get("ses_1")!.callerIdHash).toBeNull();
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
  it("needs both first name and platform; a name alone twice leads to take-a-message", async () => {
    const t = setup();
    await t.startSession();
    const first = await t.say("ses_1", "Ahmed ke liye delivery hai");
    expect(first).toEqual({ status: 200, body: { instruction: say.screenAgain("hi"), state: "screening", lostTurns: 0 } });
    const second = await t.say("ses_1", "Ahmed bhai ka order");
    expect(second).toEqual({ status: 200, body: { instruction: say.takeMessage("hi"), state: "message", lostTurns: 0 } });
    for (const r of [first, second]) {
      for (const c of home.cues) expect(String(r.body.instruction)).not.toContain(c.text);
    }
    const msg = await t.say("ses_1", "Main gate pe chhod raha hoon");
    expect(msg).toEqual({ status: 200, body: { instruction: say.messageThanks("hi"), state: "ended", lostTurns: 0 } });
    const s = t.store.sessions.get("ses_1")!;
    expect(s).toMatchObject({ state: "ended", message: "Main gate pe chhod raha hoon", endedAt: T0 });
    expect(s.screening).toEqual({ nameHeard: true, platformHeard: false, attempts: 2, objected: false });
    expect(t.store.turns.map((x) => x.utterance)).toEqual([
      "Ahmed ke liye delivery hai",
      "Ahmed bhai ka order",
      "Main gate pe chhod raha hoon",
    ]);
  });

  it("platform alone twice also leads to take-a-message", async () => {
    const t = setup();
    await t.startSession();
    await t.say("ses_1", "Swiggy se hoon");
    const res = await t.say("ses_1", "Swiggy delivery");
    expect(res.body).toEqual({ instruction: say.takeMessage("hi"), state: "message", lostTurns: 0 });
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
    const res = await t.say("ses_1", "pata nahi");
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

  it("gives an off-route rider a street-name step towards the nearest remaining cue (P5)", async () => {
    const t = setup();
    await guiding(t);
    const res = await t.say("ses_1", "Iyengar bakery ke saamne hoon");
    expect(res.body).toEqual({
      instruction: say.routeStep("hi", "Bellary Road", "Hanuman temple"),
      state: "guiding",
      lostTurns: 0,
    });
    expect(String(res.body.instruction)).not.toMatch(/\b(left|right|baayen|daayen)\b/i);
    expect(t.store.turns.at(-1)).toMatchObject({ matchedOsmId: "node/102", matchedCueId: null, lost: false });
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
