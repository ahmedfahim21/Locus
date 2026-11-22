/**
 * Runs the photo pipeline once against the real services (OpenAI vision,
 * Supabase Storage), with an in-memory store, then deletes what it stored.
 * Usage: pnpm --filter @locus/api smoke:photos <lat> <lon> <photo.jpg> [more.jpg…]
 */
import { cropJpeg } from "../enrich/frames.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env, optionalEnv } from "../config.js";
import { processPhotos } from "../enrich/processPhotos.js";
import { OpenAIVision } from "../enrich/vision.js";
import { MemoryStore } from "../store/memory.js";
import { WALK_BUCKET } from "../storage/storage.js";
import { SupabaseStorage } from "../storage/supabaseStorage.js";

const [latArg, lonArg, ...files] = process.argv.slice(2);
const door = { lat: Number(latArg), lon: Number(lonArg) };
if (!Number.isFinite(door.lat) || !Number.isFinite(door.lon) || files.length === 0) {
  throw new Error("Usage: smoke:photos <lat> <lon> <photo.jpg> [more.jpg…]");
}
const log = (e: Record<string, unknown>) => console.log(JSON.stringify(e));
const storage = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), WALK_BUCKET);
const store = new MemoryStore();
const walkId = `walk_smoke_${randomUUID().slice(0, 8)}`;
await store.createWalk({
  id: walkId, recipientId: "rcp_smoke", videoPath: `photos/rcp_smoke/${walkId}`, contentType: "image/jpeg", durationS: 0, track: [],
  status: "processing", error: null, createdAt: new Date(), processedAt: null, videoDeletedAt: new Date(),
});
const photos = await Promise.all(files.map((f) => readFile(f)));
await processPhotos(
  {
    store, storage, now: () => new Date(), newId: () => randomUUID().slice(0, 8), log, frames: { crop: cropJpeg },
    vision: new OpenAIVision(env("OPENAI_API_KEY"), optionalEnv("OPENAI_VISION_MODEL") ?? env("OPENAI_MODEL"), log),
  },
  walkId, photos, door,
);
const walk = await store.getWalk(walkId);
const proposals = await store.listWalkProposals(walkId);
log({ step: "walk", status: walk?.status, error: walk?.error });
for (const p of proposals) log({ step: "proposal", name: p.name, nameHi: p.nameHi, kind: p.kind, color: p.color, osmId: p.osmId, placedAtGate: p.location.lat === door.lat && p.location.lon === door.lon });
await storage.remove(proposals.flatMap((p) => (p.framePath ? [p.framePath] : [])));
log({ step: "cleaned up" });
process.exit(walk?.status === "ready" ? 0 : 1);
