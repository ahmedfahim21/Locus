/**
 * Runs the walk-video pipeline once against the real services, without a
 * browser: Supabase Storage (bucket, signed upload the way the web app does it,
 * download, signed reads, delete), ffmpeg and OpenAI vision. Data lives in an
 * in-memory store; every object it writes is deleted at the end.
 *
 * Usage: pnpm --filter @locus/api smoke:walk <video file> [webm|mp4]
 *
 * With `--for <recipientId>` it instead writes a real walk for that recipient
 * to Postgres, ending at their door, and keeps it, so the review screen can be
 * tested without a phone: open the printed /setup URL while signed in.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env, optionalEnv } from "../config.js";
import type { Walk } from "../domain/types.js";
import { extractFrames, probeDurationS } from "../enrich/frames.js";
import { processWalk } from "../enrich/processWalk.js";
import { OpenAIVision } from "../enrich/vision.js";
import { MemoryStore } from "../store/memory.js";
import { PostgresStore } from "../store/postgres.js";
import type { Store } from "../store/store.js";
import { WALK_BUCKET } from "../storage/storage.js";
import { SupabaseStorage } from "../storage/supabaseStorage.js";

const args = process.argv.slice(2);
const forIndex = args.indexOf("--for");
const forRecipient = forIndex >= 0 ? args[forIndex + 1] : undefined;
if (forIndex >= 0 && !forRecipient) throw new Error("--for needs a recipient id");
const [file, kind = "webm"] = args.filter((_, i) => forIndex < 0 || (i !== forIndex && i !== forIndex + 1));
if (!file) throw new Error("Usage: smoke:walk <video file> [webm|mp4] [--for <recipientId>]");
const contentType = kind === "mp4" ? "video/mp4" : "video/webm";

const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
const storage = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), WALK_BUCKET);
await storage.ensureBucket();

const store: Store = forRecipient ? new PostgresStore(env("DATABASE_URL")) : new MemoryStore();
const recipientId = forRecipient ?? "rcp_smoke";
const home = forRecipient ? await store.getHomeProfile(forRecipient) : null;
if (forRecipient && !home) throw new Error(`Recipient ${forRecipient} has no saved door yet`);
const walkId = `walk_smoke_${randomUUID().slice(0, 8)}`;
const videoPath = `walks/${recipientId}/${walkId}.${kind}`;

// Upload exactly as the browser does: a one-time signed URL, the publishable key, a PUT.
const video = await readFile(file);
const upload = await storage.createUploadUrl(videoPath);
const put = await fetch(upload.url, {
  method: "PUT",
  headers: { apikey: env("SUPABASE_PUBLISHABLE_KEY"), "content-type": contentType },
  body: new Uint8Array(video),
});
if (!put.ok) throw new Error(`Signed upload returned ${put.status}: ${await put.text()}`);
log({ step: "uploaded", path: videoPath, bytes: video.length });

// ~120 m walk over the video's length: along a Hebbal lane, or ending at the recipient's door.
const durationS = await probeDurationS(file);
const to = home?.handoffPoint ?? { lat: 13.0369, lon: 77.5932 };
const from = { lat: to.lat - 0.001, lon: to.lon - 0.0007 };
const walk: Walk = {
  id: walkId,
  recipientId,
  videoPath,
  contentType,
  durationS,
  track: [0, 0.5, 1].map((f) => ({
    t: Math.round(f * durationS * 1000),
    lat: from.lat + (to.lat - from.lat) * f,
    lon: from.lon + (to.lon - from.lon) * f,
    accuracyM: 5,
  })),
  status: "processing",
  error: null,
  createdAt: new Date(),
  processedAt: null,
  videoDeletedAt: null,
};
await store.createWalk(walk);

const model = optionalEnv("OPENAI_VISION_MODEL") ?? env("OPENAI_MODEL");
await processWalk(
  {
    store,
    storage,
    vision: new OpenAIVision(env("OPENAI_API_KEY"), model, log),
    frames: { probeDurationS, extractFrames },
    now: () => new Date(),
    newId: () => randomUUID().slice(0, 8),
    log,
  },
  walkId,
);

const done = await store.getWalk(walkId);
const proposals = await store.listWalkProposals(walkId);
log({ step: "walk", status: done?.status, error: done?.error, videoDeleted: Boolean(done?.videoDeletedAt) });
for (const p of proposals) log({ step: "proposal", ordinal: p.ordinal, name: p.name, nameHi: p.nameHi, nameKn: p.nameKn, aliases: p.aliases, kind: p.kind, atS: p.atS });

// The video must be gone; each frame must be readable through its signed URL.
const videoGone = await storage.download(videoPath).then(
  () => false,
  () => true,
);
const frames = proposals.flatMap((p) => (p.framePath ? [p.framePath] : []));
const urls = await storage.signedUrls(frames, 60);
const reads = await Promise.all([...urls.values()].map(async (u) => (await fetch(u)).headers.get("content-type")));
log({ step: "checks", videoGone, frames: frames.length, frameTypes: reads });

if (forRecipient) {
  log({ step: "kept for review", open: `/setup?step=walk&walk=${walkId}` });
} else {
  await storage.remove([...frames, videoPath]);
  log({ step: "cleaned up" });
}
process.exit(done?.status === "ready" && videoGone && reads.every((t) => t === "image/jpeg") ? 0 : 1);
