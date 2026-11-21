import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { RecipientIdentity, VerifyRecipient } from "./auth/supabaseJwt.js";
import { encodeDigipin } from "./digipin/digipin.js";
import { distinctNames } from "./clues/normalize.js";
import {
  EXPECTING_DELIVERY_MS,
  type Cue,
  type HomeProfile,
  type LatLon,
  type Session,
  type Walk,
  type WalkProposal,
} from "./domain/types.js";
import { processWalk, type WalkDeps } from "./enrich/processWalk.js";
import { distanceM } from "./geo/distance.js";
import type { RoadGraph } from "./geo/roadGraph.js";
import { MAX_UPLOAD_BYTES, VIDEO_TYPES, type ObjectStorage } from "./storage/storage.js";
import type { Store } from "./store/store.js";

export const MAX_CUES = 8;
export const RECENT_CALLS = 10;
/** A last landmark this close to the door is the door itself; the route doesn't add a leg. */
const DOOR_SAME_AS_CUE_M = 15;
/** Signed photo URLs stay valid this long; the app reloads /me well within it. */
const PHOTO_URL_TTL_S = 3600;
export const MAX_WALK_S = 180;

type Env = { Variables: { identity: RecipientIdentity } };

const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();

const profileBody = z
  .object({
    firstName: z.string().trim().min(1).max(40),
    platforms: z.array(z.string().trim().min(1).max(30)).min(1).max(6),
    fallbackNote: z.string().trim().min(1).max(200),
    phone: z.string().regex(/^\+\d{8,15}$/, "Phone must be E.164, e.g. +919800000000"),
  })
  .strict();

const homeBody = z
  .object({
    handoffPoint: latLon,
    cues: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(200),
            landmark: z.string().trim().min(1).max(60),
            location: latLon,
            /** Extra names typed by the recipient. */
            aliases: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
            /** A walk-video landmark this cue keeps: its photo and names come from the proposal. */
            proposalId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_CUES),
  })
  .strict();

const expectingBody = z.object({ on: z.boolean() }).strict();

const walkBody = z
  .object({
    contentType: z.enum(VIDEO_TYPES),
    durationS: z.number().positive().max(MAX_WALK_S, `Keep the walk under ${MAX_WALK_S / 60} minutes`),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES, "The video is over 50 MB. Record a shorter walk."),
    track: z
      .array(
        z
          .object({
            t: z.number().min(0),
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
            accuracyM: z.number().min(0),
          })
          .strict(),
      )
      .min(2, "No GPS track: turn on location and record again")
      .max(5000),
  })
  .strict();

const VIDEO_EXT: Record<(typeof VIDEO_TYPES)[number], string> = { "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov" };

function fail(c: Context, status: 400 | 401 | 404 | 409, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function publicHome(home: HomeProfile | null, photos: Map<string, string>, proposalByFrame: Map<string, string>) {
  if (!home) return null;
  return {
    handoffPoint: home.handoffPoint,
    digipin: home.digipin,
    confirmedAt: home.confirmedAt.toISOString(),
    cues: home.cues.map((c) => ({
      text: c.text,
      landmark: c.landmark,
      location: c.location,
      aliases: c.aliases,
      source: c.source,
      photoUrl: c.photoPath ? (photos.get(c.photoPath) ?? null) : null,
      proposalId: c.photoPath ? (proposalByFrame.get(c.photoPath) ?? null) : null,
    })),
  };
}

function publicWalk(w: Walk) {
  return {
    id: w.id,
    status: w.status,
    error: w.error,
    createdAt: w.createdAt.toISOString(),
    processedAt: w.processedAt?.toISOString() ?? null,
  };
}

function publicProposal(p: WalkProposal, photos: Map<string, string>) {
  return {
    id: p.id,
    ordinal: p.ordinal,
    name: p.name,
    nameHi: p.nameHi,
    nameKn: p.nameKn,
    aliases: p.aliases,
    kind: p.kind,
    location: p.location,
    osmId: p.osmId,
    atS: p.atS,
    status: p.status,
    photoUrl: p.framePath ? (photos.get(p.framePath) ?? null) : null,
  };
}

function publicCall(s: Session, turns: { utterance: string | null; instruction: string; lost: boolean; createdAt: Date }[]) {
  return {
    id: s.id,
    state: s.state,
    noTranscript: s.mode === "noTranscript",
    createdAt: s.createdAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    message: s.message,
    /** Ordinal of the last landmark the rider reached; 0 before the first. */
    reachedCue: s.currentCue + 1,
    handoff: s.handoff
      ? {
          startedAt: s.handoff.startedAt.toISOString(),
          endedAt: s.handoff.endedAt?.toISOString() ?? null,
          answered: s.handoff.answered,
        }
      : null,
    turns: turns.map((t) => ({
      utterance: t.utterance,
      instruction: t.instruction,
      lost: t.lost,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

/**
 * Routes the recipient web app calls, authenticated with a Supabase Auth access token.
 * A recipient only ever reads and writes their own profile, home and calls.
 */
export function recipientRoutes(deps: {
  store: Store;
  verifyRecipient: VerifyRecipient;
  webOrigin: string;
  now: () => Date;
  newId: () => string;
  graphFor: (home: HomeProfile) => Promise<RoadGraph>;
  storage: ObjectStorage;
  walk: Omit<WalkDeps, "store" | "storage" | "now" | "newId">;
  /** Runs work after the response is sent (walk processing). */
  background: (task: () => Promise<void>) => void;
}) {
  const { store, storage } = deps;
  const walkDeps: WalkDeps = { ...deps.walk, store, storage, now: deps.now, newId: deps.newId };
  const app = new Hono<Env>();

  app.use("*", cors({ origin: deps.webOrigin, allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "PUT", "POST"] }));
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const auth = c.req.header("authorization") ?? "";
    const identity = auth.startsWith("Bearer ") ? await deps.verifyRecipient(auth.slice(7)) : null;
    if (!identity) return fail(c, 401, "UNAUTHORIZED", "Sign in again");
    c.set("identity", identity);
    await next();
  });

  async function me(c: Context<Env>) {
    const id = await store.getRecipientIdByAuthSubject(c.get("identity").sub);
    return id ? store.getRecipient(id) : null;
  }

  /** The home as the app sees it: cue photos signed, and the proposal each photo came from. */
  async function homeView(recipientId: string, home: HomeProfile | null) {
    if (!home) return null;
    const paths = home.cues.flatMap((c) => (c.photoPath ? [c.photoPath] : []));
    if (paths.length === 0) return publicHome(home, new Map(), new Map());
    const [photos, proposals] = await Promise.all([
      storage.signedUrls(paths, PHOTO_URL_TTL_S),
      store.listRecipientProposals(recipientId),
    ]);
    const byFrame = new Map(proposals.flatMap((p) => (p.framePath ? [[p.framePath, p.id] as const] : [])));
    return publicHome(home, photos, byFrame);
  }

  async function ownWalk(c: Context<Env>) {
    const recipient = await me(c);
    const walk = recipient ? await store.getWalk(c.req.param("id")!) : null;
    return walk && walk.recipientId === recipient!.id ? walk : null;
  }

  app.get("/", async (c) => {
    const identity = c.get("identity");
    const recipient = await me(c);
    if (!recipient) {
      return c.json({ identity: { email: identity.email, name: identity.name }, recipient: null, home: null, number: null });
    }
    const [home, number] = await Promise.all([
      store.getHomeProfile(recipient.id),
      store.getNumberForRecipient(recipient.id),
    ]);
    return c.json({
      identity: { email: identity.email, name: identity.name },
      recipient: {
        firstName: recipient.firstName,
        platforms: recipient.platforms,
        fallbackNote: recipient.fallbackNote,
        phone: recipient.phone,
        expectingDeliveryUntil: recipient.expectingDeliveryUntil?.toISOString() ?? null,
      },
      home: await homeView(recipient.id, home),
      number: number?.did ?? null,
    });
  });

  app.put("/profile", async (c) => {
    const parsed = profileBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    const sub = c.get("identity").sub;
    const id = (await store.getRecipientIdByAuthSubject(sub)) ?? `rcp_${deps.newId()}`;
    await store.saveRecipientProfile(sub, { id, ...parsed.data });
    return c.json({ recipient: parsed.data });
  });

  app.put("/home", async (c) => {
    const recipient = await me(c);
    if (!recipient) return fail(c, 404, "PROFILE_NOT_SET_UP", "Save your profile first");
    const parsed = homeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    let digipin: string;
    try {
      digipin = encodeDigipin(parsed.data.handoffPoint);
    } catch (err) {
      return fail(c, 400, "INVALID_BODY", `Handoff point is outside India: ${(err as Error).message}`);
    }
    const proposals = await store.listRecipientProposals(recipient.id);
    const byId = new Map(proposals.map((p) => [p.id, p]));
    const homeId = `home_${recipient.id}`;
    const cues: Cue[] = [];
    for (const [i, input] of parsed.data.cues.entries()) {
      const proposal = input.proposalId ? byId.get(input.proposalId) : undefined;
      if (input.proposalId && (!proposal || proposal.status === "rejected" || !proposal.framePath)) {
        return fail(c, 400, "PROPOSAL_UNAVAILABLE", `The photo for "${input.landmark}" is no longer available. Remove it or add it again.`);
      }
      cues.push({
        id: `${homeId}_cue_${i + 1}`,
        ordinal: i + 1,
        text: input.text,
        landmark: input.landmark,
        location: input.location,
        aliases: distinctNames(
          [
          ...(input.aliases ?? []),
          ...(proposal ? [proposal.name, proposal.nameHi, proposal.nameKn, ...proposal.aliases] : []),
          ],
          input.landmark,
        ),
        source: proposal ? "walkVideo" : "typed",
        photoPath: proposal?.framePath ?? null,
      });
    }
    const home: HomeProfile = {
      id: homeId,
      recipientId: recipient.id,
      handoffPoint: parsed.data.handoffPoint,
      digipin,
      confirmedAt: deps.now(),
      cues,
    };
    await store.replaceHomeProfile(home);

    // Proposals the home now uses are kept; every other one is rejected and its frame deleted (section 4.6).
    const used = new Set(parsed.data.cues.flatMap((cue) => (cue.proposalId ? [cue.proposalId] : [])));
    const changed = proposals
      .filter((p) => (used.has(p.id) ? p.status !== "kept" : p.status !== "rejected" || p.framePath))
      .map((p): WalkProposal => (used.has(p.id) ? { ...p, status: "kept" } : { ...p, status: "rejected", framePath: null }));
    const dropFrames = proposals.filter((p) => !used.has(p.id) && p.framePath).map((p) => p.framePath!);
    await storage.remove(dropFrames);
    await store.updateProposals(changed);

    return c.json({ home: await homeView(recipient.id, home) });
  });

  app.put("/expecting", async (c) => {
    const recipient = await me(c);
    if (!recipient) return fail(c, 404, "PROFILE_NOT_SET_UP", "Save your profile first");
    const parsed = expectingBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    const until = parsed.data.on ? new Date(deps.now().getTime() + EXPECTING_DELIVERY_MS) : null;
    await store.setExpectingDelivery(recipient.id, until);
    return c.json({ expectingDeliveryUntil: until?.toISOString() ?? null });
  });

  /**
   * The route a rider walks: landmark 1 → … → last landmark → door, along OSM
   * roads. A leg with no road connection (no OSM import yet, or a gap in the
   * data) comes back as a straight line with `onRoads: false`, so the app can
   * draw it differently instead of pretending it's a road.
   */
  app.get("/route", async (c) => {
    const recipient = await me(c);
    if (!recipient) return fail(c, 404, "PROFILE_NOT_SET_UP", "Save your profile first");
    const home = await store.getHomeProfile(recipient.id);
    if (!home) return fail(c, 404, "HOME_NOT_SET_UP", "Save your door and landmarks first");
    const graph = await deps.graphFor(home);
    const stops: LatLon[] = [...home.cues].sort((a, b) => a.ordinal - b.ordinal).map((cue) => cue.location);
    const last = stops[stops.length - 1]!;
    if (distanceM(last, home.handoffPoint) > DOOR_SAME_AS_CUE_M) stops.push(home.handoffPoint);
    const legs = stops.slice(1).map((to, i) => {
      const from = stops[i]!;
      const road = graph.roadLine(from, to);
      return road.reachable
        ? { onRoads: true, line: [from, ...road.line, to] }
        : { onRoads: false, line: [from, to] };
    });
    return c.json({ legs });
  });

  /** Starts a walk: records its GPS track and returns a one-time upload URL for the video. */
  app.post("/walks", async (c) => {
    const recipient = await me(c);
    if (!recipient) return fail(c, 404, "PROFILE_NOT_SET_UP", "Save your profile first");
    const parsed = walkBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_BODY", parsed.error.issues[0]?.message ?? "Invalid body");
    try {
      encodeDigipin(parsed.data.track[0]!);
    } catch {
      return fail(c, 400, "INVALID_BODY", "The walk's GPS track is outside India");
    }
    const id = `walk_${deps.newId()}`;
    const walk: Walk = {
      id,
      recipientId: recipient.id,
      videoPath: `walks/${recipient.id}/${id}.${VIDEO_EXT[parsed.data.contentType]}`,
      contentType: parsed.data.contentType,
      durationS: parsed.data.durationS,
      track: parsed.data.track,
      status: "awaitingUpload",
      error: null,
      createdAt: deps.now(),
      processedAt: null,
      videoDeletedAt: null,
    };
    const upload = await storage.createUploadUrl(walk.videoPath);
    await store.createWalk(walk);
    return c.json({ walk: publicWalk(walk), upload: { path: upload.path, token: upload.token } }, 201);
  });

  /** Call after the upload finishes. Processing runs in the background; poll GET /walks/:id. */
  app.post("/walks/:id/process", async (c) => {
    const walk = await ownWalk(c);
    if (!walk) return fail(c, 404, "WALK_NOT_FOUND", "Walk not found");
    if (walk.status === "processing" || walk.status === "ready") {
      return fail(c, 409, "WALK_ALREADY_PROCESSED", `This walk is already ${walk.status}`);
    }
    const processing: Walk = { ...walk, status: "processing", error: null };
    await store.updateWalk(processing);
    deps.background(() => processWalk(walkDeps, walk.id));
    return c.json({ walk: publicWalk(processing) }, 202);
  });

  app.get("/walks/:id", async (c) => {
    const walk = await ownWalk(c);
    if (!walk) return fail(c, 404, "WALK_NOT_FOUND", "Walk not found");
    const proposals = walk.status === "ready" ? await store.listWalkProposals(walk.id) : [];
    const photos = await storage.signedUrls(
      proposals.flatMap((p) => (p.framePath ? [p.framePath] : [])),
      PHOTO_URL_TTL_S,
    );
    return c.json({ walk: publicWalk(walk), proposals: proposals.map((p) => publicProposal(p, photos)) });
  });

  app.get("/calls", async (c) => {
    const recipient = await me(c);
    if (!recipient) return c.json({ calls: [] });
    const sessions = await store.listRecentSessions(recipient.id, RECENT_CALLS);
    const calls = await Promise.all(sessions.map(async (s) => publicCall(s, await store.listTurns(s.id))));
    return c.json({ calls });
  });

  return app;
}
