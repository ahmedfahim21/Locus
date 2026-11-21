import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env, optionalEnv } from "./config.js";
import { createSupabaseVerifier } from "./auth/supabaseJwt.js";
import { createResolver } from "./guide/createResolver.js";
import { extractFrames, probeDurationS } from "./enrich/frames.js";
import { OpenAIVision } from "./enrich/vision.js";
import { WALK_BUCKET } from "./storage/storage.js";
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
const storage = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), WALK_BUCKET);
await storage.ensureBucket();
const visionModel = optionalEnv("OPENAI_VISION_MODEL") ?? env("OPENAI_MODEL");
const app = createApp({
  store,
  resolver,
  now: () => new Date(),
  newId: () => randomUUID(),
  log,
  verifyRecipient,
  webOrigin: env("LOCUS_WEB_ORIGIN"),
  storage,
  vision: new OpenAIVision(env("OPENAI_API_KEY"), visionModel, log),
  frames: { probeDurationS, extractFrames },
  background: (task) => {
    task().catch((err: Error) => log({ event: "background.failed", message: err.message, stack: err.stack }));
  },
});

const port = Number(optionalEnv("LOCUS_PORT") ?? "8787");
serve({ fetch: app.fetch, port }, () => log({ event: "listening", port, resolver: provider, model, visionModel, bucket: WALK_BUCKET }));
