import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env, optionalEnv } from "./config.js";
import { createSupabaseVerifier } from "./auth/supabaseJwt.js";
import { createResolver } from "./guide/createResolver.js";
import { extractFrames, probeDurationS, cropJpeg } from "./enrich/frames.js";
import { recoverWalks, sweepUnreviewedFrames, sweepWalkVideos } from "./enrich/sweep.js";
import { SarvamTransliterator } from "./enrich/transliterate.js";
import { OpenAIVision } from "./enrich/vision.js";
import { LiveKitPhoneCalls, LiveKitTestCalls } from "./voice/testCall.js";
import { GoogleStreetView } from "./onboarding/streetView.js";
import { WALK_BUCKET, SignedUrlCache } from "./storage/storage.js";
import { SupabaseStorage } from "./storage/supabaseStorage.js";
import { PostgresStore } from "./store/postgres.js";

const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

const store = new PostgresStore(env("DATABASE_URL"));
const { resolver, provider, model } = createResolver(log);
const verifyRecipient = createSupabaseVerifier({
  jwksUrl: env("SUPABASE_JWKS_URL"),
  issuer: `${env("SUPABASE_URL").replace(/\/$/, "")}/auth/v1`,
  log,
});
const supabaseStorage = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), WALK_BUCKET);
await supabaseStorage.ensureBucket();
// Photo URLs stay the same across visits, so browsers cache the images.
const storage = new SignedUrlCache(supabaseStorage);
const visionModel = optionalEnv("OPENAI_VISION_MODEL") ?? env("OPENAI_MODEL");
const vision = new OpenAIVision(env("OPENAI_API_KEY"), visionModel, log);
const frames = { probeDurationS, extractFrames, crop: cropJpeg };
const app = createApp({
  store,
  resolver,
  now: () => new Date(),
  newId: () => randomUUID(),
  log,
  verifyRecipient,
  // Comma-separated: the custom domain and the Vercel URL can both use the API.
  webOrigin: env("LOCUS_WEB_ORIGIN").split(",").map((o) => o.trim()).filter(Boolean),
  storage,
  vision,
  transliterator: new SarvamTransliterator(env("SARVAM_API_KEY"), log),
  streetImagery: optionalEnv("GOOGLE_MAPS_API_KEY") ? new GoogleStreetView(env("GOOGLE_MAPS_API_KEY"), log) : null,
  testCalls: optionalEnv("LIVEKIT_URL")
    ? new LiveKitTestCalls(env("LIVEKIT_URL"), env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"))
    : null,
  phoneCalls: optionalEnv("LIVEKIT_SIP_OUTBOUND_TRUNK_ID")
    ? new LiveKitPhoneCalls(
        env("LIVEKIT_URL"),
        env("LIVEKIT_API_KEY"),
        env("LIVEKIT_API_SECRET"),
        env("LIVEKIT_SIP_OUTBOUND_TRUNK_ID"),
        env("LOCUS_OUTBOUND_NUMBER"),
      )
    : null,
  frames,
  background: (task) => {
    task().catch((err: Error) => log({ event: "background.failed", message: err.message, stack: err.stack }));
  },
});

// Privacy: walk videos never outlive a day in storage, and unreviewed landmark crops a week.
const sweep = () => {
  const deps = { store, storage, now: () => new Date(), log };
  sweepWalkVideos(deps).catch((err: Error) => log({ event: "walk.sweep_failed", message: err.message, stack: err.stack }));
  sweepUnreviewedFrames(deps).catch((err: Error) => log({ event: "walk.frames_sweep_failed", message: err.message, stack: err.stack }));
};
void sweep();
setInterval(sweep, 6 * 3600_000).unref();

// Walk jobs run in this process: after a restart, pick up the ones it was in the middle of.
recoverWalks({ store, storage, vision, frames, now: () => new Date(), newId: () => randomUUID(), log }).catch((err: Error) =>
  log({ event: "walk.recover_failed", message: err.message, stack: err.stack }),
);

const port = Number(optionalEnv("LOCUS_PORT") ?? "8787");
serve({ fetch: app.fetch, port }, () => log({ event: "listening", port, resolver: provider, model, visionModel, bucket: WALK_BUCKET }));
