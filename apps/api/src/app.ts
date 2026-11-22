import type { StreetImagery } from "./onboarding/streetView.js";
import { keytermsFor } from "./voice/keyterms.js";
import type { PhoneCaller, TestCallIssuer } from "./voice/testCall.js";
import type { NameTransliterator } from "./enrich/transliterate.js";
import type { LandmarkVision } from "./enrich/vision.js";
import type { WalkDeps } from "./enrich/processWalk.js";
import type { ObjectStorage } from "./storage/storage.js";
import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { ApiClient, HomeProfile, Language, LatLon, OsmFeature, Recipient, Session } from "./domain/types.js";
import { RoadGraph } from "./geo/roadGraph.js";
import { applyHandoffResult, handleRiderInput, isOpen } from "./guide/engine.js";
import { say } from "./guide/phrases.js";
import type { PositionResolver } from "./guide/resolver.js";
import type { VerifyRecipient } from "./auth/supabaseJwt.js";
import { recipientRoutes } from "./recipientRoutes.js";
import { inHandoffWindow } from "./handoff/loopGuard.js";
import type { Store } from "./store/store.js";

export const SEARCH_RADIUS_M = 500;

export type Deps = {
  store: Store;
  resolver: PositionResolver;
  now: () => Date;
  newId: () => string;
  log: (event: Record<string, unknown>) => void;
  verifyRecipient: VerifyRecipient;
  /** Origin of the recipient web app, allowed by CORS on /me. */
  webOrigin: string | string[];
  /** Walk videos and landmark frames. */
  storage: ObjectStorage;
  vision: LandmarkVision;
  transliterator: NameTransliterator;
  testCalls: TestCallIssuer | null;
  /** Phones a rider for "Call the rider"; null without an outbound SIP trunk. */
  phoneCalls: PhoneCaller | null;
  /** Street-level imagery for landmark suggestions; null when no key is configured. */
  streetImagery: StreetImagery | null;
  frames: WalkDeps["frames"];
  /** Runs work after the response is sent (walk processing). */
  background: (task: () => Promise<void>) => void;
};

export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_BODY"
  | "NUMBER_NOT_SET_UP"
  | "RECIPIENT_NOT_FOUND"
  | "HOME_NOT_SET_UP"
  | "DELIVERY_NOT_EXPECTED"
  | "LOOP_REJECTED"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "NOT_IN_HANDOFF"
  | "INTERNAL";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

type Env = { Variables: { client: ApiClient; requestId: string } };

const createSessionBody = z
  .object({
    did: z.string().min(1).optional(),
    recipientId: z.string().min(1).optional(),
    callerId: z.string().min(1).optional(),
    language: z.enum(["hi", "en"]).optional(),
  })
  .strict()
  .refine((b) => (b.did === undefined) !== (b.recipientId === undefined), {
    message: "Provide exactly one of did or recipientId",
  });

const utteranceBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("speech"), text: z.string().min(1), language: z.string().min(2).optional() }).strict(),
  z.object({ kind: z.literal("silence") }).strict(),
]);

const handoffBody = z.object({ answered: z.boolean() }).strict();

function fail(c: Context, status: 400 | 401 | 404 | 409 | 500, code: ErrorCode, message: string, extra = {}) {
  return c.json({ error: { code, message, ...extra } }, status);
}

/** How long cached OSM data and API-client lookups are trusted. */
const GEO_CACHE_MS = 10 * 60_000;
const CLIENT_CACHE_MS = 60_000;
/** A call open longer than this is read from the database again. */
const CALL_CACHE_MS = 30 * 60_000;

export function createApp(deps: Deps) {
  const { store, log } = deps;
  // OSM data and API clients change rarely; every database round trip adds to a rider's wait (~0.25 s each).
  const geo = new Map<string, { at: number; graph: Promise<RoadGraph>; features: Promise<OsmFeature[]> }>();
  const clients = new Map<string, { at: number; client: ApiClient }>();
  /**
   * Open calls, so a rider's turn reads nothing from the database. This API runs as
   * a single instance and is the only writer of sessions, so the copy here is current.
   * Recipient and home are read once per call: edits made mid-call apply to the next one.
   */
  const calls = new Map<string, { at: number; session: Session; recipient: Recipient; home: HomeProfile }>();

  function remember(session: Session, recipient: Recipient, home: HomeProfile) {
    const now = Date.now();
    for (const [id, entry] of calls) if (now - entry.at > CALL_CACHE_MS) calls.delete(id);
    if (isOpen(session)) calls.set(session.id, { at: calls.get(session.id)?.at ?? now, session, recipient, home });
    else calls.delete(session.id);
  }

  /** The caller's own open-or-closed session with its recipient and home, from memory when the call is live. */
  async function ownedCall(c: Context<Env>): Promise<{ session: Session; recipient: Recipient; home: HomeProfile } | null> {
    const id = c.req.param("id")!;
    const hit = calls.get(id);
    const call =
      hit && Date.now() - hit.at <= CALL_CACHE_MS
        ? hit
        : await (async () => {
            const session = await store.getSession(id);
            if (!session) return null;
            const [recipient, home] = await Promise.all([store.getRecipient(session.recipientId), store.getHomeProfile(session.recipientId)]);
            if (!recipient || !home) throw new Error(`recipient or home missing for session ${session.id}`);
            return { session, recipient, home };
          })();
    if (!call || call.session.clientId !== c.get("client").id) return null;
    return { session: call.session, recipient: call.recipient, home: call.home };
  }

  /** Road graph and named places around a point, cached per point so moving the door rebuilds them. */
  function geoAt(point: LatLon) {
    const key = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
    const now = Date.now();
    let entry = geo.get(key);
    if (!entry || now - entry.at > GEO_CACHE_MS) {
      entry = {
        at: now,
        graph: store.nearbyWays(point, SEARCH_RADIUS_M).then((ways) => new RoadGraph(ways)),
        features: store.nearbyFeatures(point, SEARCH_RADIUS_M),
      };
      // A failed load must not stay cached.
      Promise.all([entry.graph, entry.features]).catch(() => geo.delete(key));
      geo.set(key, entry);
    }
    return entry;
  }

  const geoFor = (home: HomeProfile) => geoAt(home.handoffPoint);
  const graphFor = (home: HomeProfile) => geoFor(home).graph;

  async function contextFor(home: HomeProfile) {
    const entry = geoFor(home);
    const [features, graph] = await Promise.all([entry.features, entry.graph]);
    return { features, graph };
  }

  async function clientFor(key: string): Promise<ApiClient | null> {
    const hash = sha256(key);
    const hit = clients.get(hash);
    if (hit && Date.now() - hit.at < CLIENT_CACHE_MS) return hit.client;
    const client = await store.getClientByKeyHash(hash);
    if (client) clients.set(hash, { at: Date.now(), client });
    else clients.delete(hash);
    return client;
  }

  const app = new Hono<Env>();

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? randomUUID();
    log({ event: "error", requestId, path: c.req.path, message: err.message, stack: err.stack });
    return fail(c, 500, "INTERNAL", "Internal error", { requestId });
  });

  app.use("/v1/*", async (c, next) => {
    c.set("requestId", randomUUID());
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const client = key ? await clientFor(key) : null;
    if (!client) return fail(c, 401, "UNAUTHORIZED", "Missing or invalid API key");
    c.set("client", client);
    await next();
  });

  app.post("/v1/sessions", async (c) => {
    const parsed = createSessionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    const body = parsed.data;
    const now = deps.now();

    // Loop guard part 1 (P3): Locus's own numbers never reach the agent.
    if (body.callerId && (await store.isLocusNumber(body.callerId))) {
      return fail(c, 409, "LOOP_REJECTED", "Caller is a Locus number");
    }

    let recipientId = body.recipientId;
    if (body.did) {
      const number = await store.getNumberByDid(body.did);
      if (!number) return fail(c, 404, "NUMBER_NOT_SET_UP", "This number isn't set up");
      recipientId = number.recipientId;
    }
    const recipient = await store.getRecipient(recipientId!);
    if (!recipient) return fail(c, 404, "RECIPIENT_NOT_FOUND", "Recipient not found");

    // Loop guard part 2 (P3): during a handoff leg and 60 s after it.
    if (inHandoffWindow(await store.latestHandoff(recipient.id), now)) {
      return fail(c, 409, "LOOP_REJECTED", "Recipient has an active or recent handoff call");
    }
    // P2/P4: the switch is checked by the server for every client.
    if (!recipient.expectingDeliveryUntil || recipient.expectingDeliveryUntil <= now) {
      return fail(c, 409, "DELIVERY_NOT_EXPECTED", "Recipient isn't expecting a delivery right now");
    }
    const home = await store.getHomeProfile(recipient.id);
    if (!home || home.cues.length === 0) return fail(c, 409, "HOME_NOT_SET_UP", "Recipient has no confirmed cues");

    const language: Language = body.language ?? "hi";
    const session: Session = {
      id: `ses_${deps.newId()}`,
      clientId: c.get("client").id,
      recipientId: recipient.id,
      callerIdHash: body.callerId ? sha256(body.callerId) : null,
      state: "screening",
      mode: "normal",
      language,
      currentCue: -1,
      lostTurns: 0,
      screening: { nameHeard: false, platformHeard: false, attempts: 0, objected: false },
      handoff: null,
      message: null,
      createdAt: now,
      endedAt: null,
    };
    await store.createSession(session);
    remember(session, recipient, home);
    log({ event: "session.created", sessionId: session.id, clientId: session.clientId });
    // Key terms include the recipient's first name, which screening checks, so only Locus's own worker gets them.
    const keyterms = c.get("client").firstParty ? keytermsFor(recipient, home, (await contextFor(home)).features) : undefined;
    return c.json({ sessionId: session.id, state: session.state, instruction: say.notice(language), ...(keyterms ? { keyterms } : {}) }, 201);
  });

  app.post("/v1/sessions/:id/utterances", async (c) => {
    const requestStarted = Date.now();
    const call = await ownedCall(c);
    if (!call) return fail(c, 404, "SESSION_NOT_FOUND", "Session not found");
    const { session, recipient, home } = call;
    if (!isOpen(session)) return fail(c, 409, "SESSION_CLOSED", `Session is ${session.state}`);
    const parsed = utteranceBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    const { features, graph } = await contextFor(home);

    const started = Date.now();
    const outcome = await handleRiderInput(session, parsed.data, {
      recipient,
      home,
      features,
      graph,
      resolver: deps.resolver,
      now: deps.now(),
    });
    // No-transcript mode (rider objected) writes no turn rows at all, and blanks the ones already written.
    await Promise.all([
      store.updateSession(outcome.session),
      outcome.session.mode === "normal" ? store.addTurn(outcome.turn) : Promise.resolve(),
      session.mode === "normal" && outcome.session.mode === "noTranscript" ? store.redactTurns(session.id) : Promise.resolve(),
    ]);
    remember(outcome.session, recipient, home);
    log({
      event: "turn",
      sessionId: session.id,
      state: outcome.session.state,
      lost: outcome.turn.lost,
      ms: Date.now() - started,
      requestMs: Date.now() - requestStarted,
    });
    const enteredHandoff = outcome.session.state === "handoff" && session.state !== "handoff";
    return c.json({
      instruction: outcome.instruction,
      state: outcome.session.state,
      lostTurns: outcome.session.lostTurns,
      // Only Locus's own worker places the handoff call; third parties hand off to their own user.
      ...(enteredHandoff && c.get("client").firstParty ? { handoffPhone: recipient.phone } : {}),
    });
  });

  app.post("/v1/sessions/:id/handoff-result", async (c) => {
    const call = await ownedCall(c);
    if (!call) return fail(c, 404, "SESSION_NOT_FOUND", "Session not found");
    const { session, recipient, home } = call;
    if (session.state !== "handoff") return fail(c, 409, "NOT_IN_HANDOFF", `Session is ${session.state}`);
    const parsed = handoffBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    const result = applyHandoffResult(session, parsed.data.answered, recipient, deps.now());
    await store.updateSession(result.session);
    remember(result.session, recipient, home);
    return c.json({ instruction: result.instruction, state: result.session.state });
  });

  app.post("/v1/sessions/:id/end", async (c) => {
    const call = await ownedCall(c);
    if (!call) return fail(c, 404, "SESSION_NOT_FOUND", "Session not found");
    const { session, recipient, home } = call;
    const now = deps.now();
    const ended: Session = {
      ...session,
      // A rider who reached the door stays "arrived"; the worker hanging up doesn't undo it.
      state: session.state === "arrived" ? "arrived" : "ended",
      endedAt: session.endedAt ?? now,
      handoff: session.handoff && session.handoff.endedAt === null ? { ...session.handoff, endedAt: now } : session.handoff,
    };
    await store.updateSession(ended);
    remember(ended, recipient, home);
    return c.json({ state: ended.state });
  });

  app.route(
    "/me",
    recipientRoutes({
      store,
      verifyRecipient: deps.verifyRecipient,
      webOrigin: deps.webOrigin,
      now: deps.now,
      newId: deps.newId,
      graphFor,
      geoAt: async (point: LatLon) => {
        const entry = geoAt(point);
        const [graph, features] = await Promise.all([entry.graph, entry.features]);
        return { graph, features };
      },
      streetImagery: deps.streetImagery,
      storage: deps.storage,
      transliterator: deps.transliterator,
      testCalls: deps.testCalls,
      phoneCalls: deps.phoneCalls,
      log,
      walk: { vision: deps.vision, frames: deps.frames, log },
      background: deps.background,
    }),
  );

  return app;
}
