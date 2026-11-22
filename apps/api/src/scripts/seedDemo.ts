/**
 * Seeds the test accounts AGENTS.md describes, through Locus's own API (the API must be running):
 *   demo@locus.ahmedfahim.dev   a recipient with a finished 10-landmark route, expecting a delivery
 *   setup-xxxxxx@locus.ahmedfahim.dev  a new account made on every run (and printed), for trying setup from the start;
 *     each run makes its own, so several people (or agents) seeding the same database never share one
 * Both use LOCUS_DEMO_PASSWORD. Sign-in users are created with Supabase's admin API (SUPABASE_SECRET_KEY);
 * everything else goes through /me as the signed-in user, the same path the web app takes.
 * Usage: pnpm --filter @locus/api seed:demo   (run osm:import with seed/osm-knowledge-city.json first)
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { env } from "../config.js";

const READY = "demo@locus.ahmedfahim.dev";
const FRESH = `setup-${randomBytes(3).toString("hex")}@locus.ahmedfahim.dev`;
/** A placeholder number: test calls never dial it, and "Call the rider" asks for a rider's number. */
const READY_PHONE = "+919000000001";

const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
const secretKey = env("SUPABASE_SECRET_KEY");
const publishableKey = env("SUPABASE_PUBLISHABLE_KEY");
const apiUrl = env("LOCUS_API_URL").replace(/\/$/, "");
const password = env("LOCUS_DEMO_PASSWORD");
if (password.length < 8) throw new Error("LOCUS_DEMO_PASSWORD must be at least 8 characters");

const latLon = z.object({ lat: z.number(), lon: z.number() });
const fixture = z
  .object({
    profile: z.object({ firstName: z.string(), platforms: z.array(z.string()).min(1), fallbackNote: z.string() }),
    home: z.object({
      handoffPoint: latLon,
      cues: z.array(z.object({ text: z.string(), landmark: z.string(), location: latLon }).passthrough()).min(1),
    }),
  })
  .parse(JSON.parse(readFileSync(new URL("../../seed/demo-home.json", import.meta.url), "utf8")));

async function call<T>(url: string, init: { method: string; headers: Record<string, string>; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method} ${url} returned ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const admin = { apikey: secretKey, authorization: `Bearer ${secretKey}` };

async function findUser(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { users } = await call<{ users: { id: string; email?: string }[] }>(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { method: "GET", headers: admin });
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
}

async function createUser(email: string) {
  await call(`${supabaseUrl}/auth/v1/admin/users`, { method: "POST", headers: admin, body: { email, password, email_confirm: true } });
}

async function signIn(email: string): Promise<string> {
  const { access_token } = await call<{ access_token: string }>(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey },
    body: { email, password },
  });
  return access_token;
}

// The ready account keeps its id (and its call history); its password, profile, route and switch are set again.
const readyId = await findUser(READY);
if (readyId) await call(`${supabaseUrl}/auth/v1/admin/users/${readyId}`, { method: "PUT", headers: admin, body: { password, email_confirm: true } });
else await createUser(READY);
const token = await signIn(READY);
const me = { authorization: `Bearer ${token}` };
await call(`${apiUrl}/me/profile`, { method: "PUT", headers: me, body: { ...fixture.profile, phone: READY_PHONE } });
await call(`${apiUrl}/me/home`, { method: "PUT", headers: me, body: fixture.home });
await call(`${apiUrl}/me/expecting`, { method: "PUT", headers: me, body: { on: true } });
const check = await call<{ recipient: { firstName: string; expectingDeliveryUntil: string | null } | null; home: { cues: unknown[] } | null }>(`${apiUrl}/me`, { method: "GET", headers: me });
if (!check.recipient || !check.home || check.home.cues.length !== fixture.home.cues.length || !check.recipient.expectingDeliveryUntil) {
  throw new Error(`${READY} didn't come back set up: ${JSON.stringify(check)}`);
}
console.log(`${READY}: ${check.home.cues.length} landmarks, expecting a delivery until ${check.recipient.expectingDeliveryUntil}`);

// A new setup account for this run, with no profile yet.
await createUser(FRESH);
const fresh = await call<{ recipient: unknown }>(`${apiUrl}/me`, { method: "GET", headers: { authorization: `Bearer ${await signIn(FRESH)}` } });
if (fresh.recipient !== null) throw new Error(`${FRESH} should start with no profile, got ${JSON.stringify(fresh.recipient)}`);
console.log(`${FRESH}: new account, no profile yet`);
