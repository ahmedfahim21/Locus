# Locus: setup, run and try it

**Live:** [locus.ahmedfahim.dev](https://locus.ahmedfahim.dev) (web app) and `https://locus-api.ahmedfahim.dev` (guide API). The test logins below work there too, so you can try every journey without installing anything.

**Demo video:** [youtu.be/X9NvQfkdu5g](https://youtu.be/X9NvQfkdu5g).

In the submission zip, next to this file: `Locus demo.mp4` (the same video, under 3 minutes), `Locus slides.pdf` (5 slides) and `.env.reviewers` (the keys, section 2).

Locus is a voice AI that answers a delivery rider's call on the recipient's behalf and guides them in Hinglish to the door, one landmark at a time. The recipient sets up their door once (a pin, then a short walk video or a few photos), switches Locus on when they expect a delivery, and gives the Locus number (or forwards their own) as the receiver's phone.

Repository layout:

| Part | Path | Port |
|---|---|---|
| Guide API (Hono, Postgres with PostGIS) | `apps/api` (`src/index.ts`) | 8787 |
| Recipient web app (Next.js 16) | `apps/web` | 3000 |
| Call worker (LiveKit Agents, Sarvam speech) | `apps/api` (`src/voice/worker.ts`) | none, connects out to LiveKit |

## 1. Prerequisites

- Node.js 22 or newer (tested on 22.15). The API uses `process.loadEnvFile`, so Node 20 will not work.
- pnpm 10.13.1: `corepack enable` picks the version pinned in `package.json`.
- FFmpeg 6 or newer, with `ffprobe`, on `PATH`. Only walk-video processing needs it; photos and calls do not.
- A Postgres 15+ database with PostGIS. The provided keys point at a hosted Supabase project (Mumbai) that already has PostGIS, sign-in and storage, so you don't run a database yourself.
- No Docker needed for local runs. `infra/docker-compose.yml` is the production setup (API, worker, Caddy) and is not part of these steps.

## 2. Environment

Everything reads one file: `.env` at the repository root. The submission zip includes `.env.reviewers` with working, low-budget keys:

```bash
cp .env.reviewers .env
```

Without that file, copy `.env.example` and fill it in. Every variable:

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | API, scripts | Postgres with PostGIS. For Supabase use the Session pooler string. |
| `SUPABASE_URL` | API, web | Sign-in and storage. |
| `SUPABASE_PUBLISHABLE_KEY` | API, web, seed | Public; reaches the browser. |
| `SUPABASE_SECRET_KEY` | API, seed | Storage for walk videos and photos, and creating test users. Never sent to the browser. |
| `SUPABASE_JWKS_URL` | API | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`; verifies sign-in tokens. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | API | Vision for walk videos and photos. `OPENAI_VISION_MODEL` overrides the model for vision only. |
| `SARVAM_API_KEY` | API, worker | Speech (Saaras v4, Bulbul v4), Hindi and Telugu spellings of landmark names, and the fallback matcher. |
| `SARVAM_LLM_MODEL` | API | Fallback matcher model, `sarvam-105b-conversations`. |
| `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER` | worker | Optional; default `saaras:v4`, `bulbul:v4-flash`, `simran_hi_conversation`. |
| `LOCUS_SPEECH_PROVIDER`, `LOCUS_RESOLVER_PROVIDER` | worker, API | `sarvam` (default) or `openai`. With `openai`, also set `OPENAI_STT_MODEL` and `OPENAI_TTS_MODEL`. |
| `LOCUS_PORT` | API | Default 8787. |
| `LOCUS_WEB_ORIGIN` | API | CORS origin(s) for the web app, comma-separated. `http://localhost:3000` locally. |
| `LOCUS_API_URL` | web, worker, seed | Where the API is: `http://localhost:8787` locally. |
| `LOCUS_DEMO_PASSWORD` | seed | Password for the test accounts (section 4). |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | voice calls | Browser voice test calls and the worker. Without them, voice test calls answer "Calls aren't set up on this server yet"; typed test calls still work. |
| `LOCUS_WORKER_API_KEY` | worker | Create with `pnpm --filter @locus/api admin client locus-worker --first-party`. |
| `LOCUS_DEFAULT_LANGUAGE` | worker | `hi` (default) or `en`. |
| `LOCUS_DEV_DID` | worker | Optional: treat calls with no phone number (LiveKit playground) as calls to this number. |
| `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`, `LOCUS_OUTBOUND_NUMBER` | phone calls | Optional. "Call the rider" and handoff calls. Unset: the button is hidden. |
| `VOBIZ_SIP_DOMAIN`, `VOBIZ_SIP_USERNAME`, `VOBIZ_SIP_PASSWORD` | `admin trunk` only | Optional. Creating the outbound SIP trunk. |
| `GOOGLE_MAPS_API_KEY` | API | Optional. Street View landmark suggestions in setup; off without it. |
| `OVERPASS_URL` | `osm:import` | Optional; defaults to the public Overpass API. |

### Using your own Supabase project instead

1. Create a project. Copy the Session pooler connection string into `DATABASE_URL` (percent-encode special characters in the password), and the project URL, publishable key and secret key into `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
2. Set `SUPABASE_JWKS_URL` to `SUPABASE_URL` plus `/auth/v1/.well-known/jwks.json`, and check under Project Settings → JWT Keys that the signing key is ECC P-256 (ES256): the API only accepts ES256 tokens.
3. Keep the Email provider on (Auth → Sign In / Providers) for the test accounts. For Google sign-in too, create a Google OAuth web client whose redirect URI is the callback Supabase shows, then enable Google in Supabase with its client ID and secret.
4. In Auth → URL Configuration, set the Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the redirect URLs.
5. `db:migrate` (below) creates the `locus` schema, PostGIS tables and indexes; the API creates the private `locus-walks` storage bucket on first start.

## 3. Install, seed and start

From the repository root, in this order:

```bash
corepack enable
pnpm install --frozen-lockfile
```

```bash
pnpm --filter @locus/api db:migrate
```

Load the streets and named places around the demo route (Knowledge City, Hyderabad) from the snapshot in the repo, so no Overpass call is needed:

```bash
pnpm --filter @locus/api osm:import 17.4314 78.3822 700 --from seed/osm-knowledge-city.json
```

Start the API (terminal 1). It's ready when it logs `{"event":"listening","port":8787,...}`:

```bash
pnpm --filter @locus/api start
```

Create the test accounts through the running API (terminal 2). It prints the accounts it made:

```bash
pnpm --filter @locus/api seed:demo
```

Start the web app (terminal 2, or 3), then open http://localhost:3000:

```bash
pnpm --filter @locus/web dev
```

For a production build instead: `pnpm --filter @locus/web build && pnpm --filter @locus/web start`.

Optional, voice calls (terminal 3). Needs the LiveKit values. Create a worker key once and put it in `.env` as `LOCUS_WORKER_API_KEY`:

```bash
pnpm --filter @locus/api admin client locus-worker --first-party
```

```bash
pnpm --filter @locus/api worker dev
```

Optional, real phone calls. Needs a Vobiz number (or another SIP provider) pointed at LiveKit's inbound SIP trunk, with a dispatch rule for the agent `locus-guide` ([Vobiz's LiveKit guide](https://www.vobiz.ai/integrations/livekit/)). Assign the number to a recipient and register it so Locus never answers its own calls, substituting your E.164 number and the recipient's id:

```bash
pnpm --filter @locus/api admin number +91XXXXXXXXXX YOUR_RECIPIENT_ID vobiz
```

```bash
pnpm --filter @locus/api admin outbound +91XXXXXXXXXX
```

For handoff calls and "Call the rider", set the `VOBIZ_SIP_*` values, create the outbound trunk, then set `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` and `LOCUS_OUTBOUND_NUMBER` from its output:

```bash
pnpm --filter @locus/api admin trunk +91XXXXXXXXXX
```

Checks (no keys or database needed; the API tests drive the HTTP routes against an in-memory store):

```bash
pnpm test
```

```bash
pnpm typecheck
```

## 4. Test logins

Sign in at `/sign-in` (the landing's "Sign in with Google or email" button goes there), under "or with email". The password for every test account is `LOCUS_DEMO_PASSWORD` in `.env.reviewers`.

| Account | Who it is | State |
|---|---|---|
| `demo@locus.ahmedfahim.dev` | A recipient, Fahim, at Knowledge City, Hyderabad | Route finished: gate pinned, 10 landmarks from the main road to the lift, "Expecting a delivery" on |
| `setup-xxxxxx@locus.ahmedfahim.dev` | A new recipient | No profile yet. `seed:demo` makes a new one on every run and prints it, so parallel runs never share one |

On the live site, the setup journey has five new accounts, one per reviewer: `setup-6b3b5e@`, `setup-2ddc8f@`, `setup-f30e1f@`, `setup-e66620@` and `setup-e6a2aa@locus.ahmedfahim.dev`. Running locally, use the one `seed:demo` printed.

There is one other kind of user, the delivery rider. Riders don't sign in: they phone the Locus number. In a test, the recipient plays the rider (section 5, journey B).

Google sign-in also works for real accounts. "Expecting a delivery" turns itself off after 3 hours; if a call says Locus isn't expecting a delivery, switch it on from the home screen or press "Turn it on and call".

## 5. Journeys to try

### A. Visitor, signed out

1. Open `/`. The landing explains the product; "Hear a call" plays a recorded demo call on a real street map (Hebbal, Bengaluru), and `/replay` shows it full screen.
2. "Sign in with Google or email" opens `/sign-in`.

### B. Recipient with a finished route (`demo@`)

1. Sign in. Home shows Fahim's door on a 3D map with the 10 landmarks, the "Expecting a delivery" switch, the Locus number, and recent calls.
2. Open "Try a call" (`/test-call`), then **"Type as the rider instead"**. You play the rider by typing; Locus replies in text through the same screening and guide loop as a phone call, and the map and transcript follow along. A full run:
   1. Locus asks who the delivery is for and from which app. Type `Fahim ke liye, Swiggy se`.
   2. Locus asks where you are. Type `Knowledge City gate pe hoon`. Locus gives the first direction.
   3. Type landmarks as you "see" them: `Laal building ke paas grey ramp wala gate hai`, then `HOSA ka board dikh raha hai`.
   4. Type `Lift ke paas aa gaya`. Locus says you've arrived and the call ends.
3. Things worth trying in a typed call:
   - A wrong name or app (`Rahul ke liye`): Locus asks only for what's missing. After 3 tries it offers to take a message for the recipient instead of guiding.
   - Something not on the route (`ek mandir dikh raha hai`): Locus says it didn't understand, and after repeated misses hands off.
   - `unse baat karao` (let me talk to them): Locus hands off. On a phone call it would ring the recipient and connect the rider; a typed call stops there and says so.
   - `record mat karo` (don't record): the call continues, but nothing from it is kept, and earlier lines are blanked.
4. Back on Home, the call appears under recent calls; open it for the transcript and the landmarks the rider reached.
5. Switch "Expecting a delivery" off and try another call: Locus refuses to start it.
6. "Door and landmarks" (under "Your route" on Home) opens setup with the saved landmarks, to rename, reorder, add or remove them.

"Start call" on the same screen is the voice version: your microphone plays the rider. It needs the LiveKit keys and the worker running, and a browser with a microphone.

### C. New recipient, setup from scratch (`setup-…@`)

1. Sign in, then open `/setup?near=17.4314,78.3822` (or just go Home, which sends a new account to setup). Setup starts at "Who is the delivery for?": a first name, the delivery apps, a fallback note, and a phone number (any `+91` number).
2. "Your gate": the map opens on Knowledge City, Hyderabad. The pin is the centre of the map; move the map so it sits on a gate within 700 m of `17.4314, 78.3822` (what the OSM snapshot covers). With `?near=17.4314,78.3822` in the setup URL the pin starts there, so a headless browser can just press "This is my gate".
3. "Film the way in": in a browser without a camera, choose "No time to walk? Add photos" and upload the four JPEGs in `apps/api/seed/photos/`. Locus reads them with OpenAI vision (a few seconds to a minute) and proposes landmarks, each with a name and a Hinglish instruction. Keep, rename or skip each one.
4. "Landmarks we found": Locus drafts the route from the nearest main road and suggests landmarks along it from the map and your photos. Keep the ones a rider would notice.
5. "Landmarks on the way": order and edit the instructions, then save. Home now shows the route; switch "Expecting a delivery" on and try journey B's typed call on your own route.

Filming a real walk needs a phone browser over HTTPS with camera and location permission; the live site is the easier place to try it.

### D. A voice agent using the guide API

The guide API decides every word Locus says, so any voice agent can use it. Create a client key, then drive a session with plain HTTP:

```bash
pnpm --filter @locus/api admin client reviewer
```

```bash
KEY=<the printed key>
RID=$(curl -s http://localhost:8787/me -H "authorization: Bearer <a signed-in access token>" | jq -r .recipient.id)
curl -s -X POST http://localhost:8787/v1/sessions -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d "{\"recipientId\":\"$RID\"}"
curl -s -X POST http://localhost:8787/v1/sessions/<sessionId>/utterances -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"kind":"speech","text":"Fahim ke liye, Swiggy se"}'
```

Each reply has the `instruction` to speak and the call's `state` (`screening`, `guiding`, `handoff`, `arrived`, …). `POST /v1/sessions/<id>/end` closes it. Typed calls in the web app are the easier way to see the same loop.

## 6. What is real, simulated or unfinished

- **Real:** screening, placing the rider from what they describe, route steps from the main road, handoff and loop guards, the guide API, walk-video and photo vision, Hindi and Telugu landmark spellings, sign-in, the delivery switch, and call history. The voice worker runs on LiveKit Cloud with Sarvam speech, and the demo phone number (+91 80 6535 4620) is a Vobiz trial number answered by that worker.
- **Typed test calls** skip speech only: the rider's text goes to the same guide session code as a transcribed phone call. Handoff on a typed call stops instead of ringing anyone.
- **Phone calls from riders:** in real use the rider calls the recipient, whose number forwards the call to Locus (or the recipient gives the Locus number as the receiver's phone). For the demo, "Call the rider" on the test-call screen has Locus dial a phone instead, so no forwarding had to be set up: same screening, guidance and voice, started from the other end. Call forwarding from a real order hasn't been tested end to end.
- **The landing's demo call** (`/replay`) is a scripted call: real Locus phrasing, voiced with Sarvam Bulbul, on a real Hebbal, Bengaluru street map. It isn't a recording of a live call.
- **No delivery-app integration.** Locus works with any app's rider because it answers a phone call; it doesn't receive orders from Swiggy, Zomato or others.
- **OSM data is loaded per area** with `osm:import`. Only Knowledge City, Hyderabad (and Hebbal, Bengaluru on the live site) are loaded. Setting up a door elsewhere works, but route drafting and map suggestions are thin until that area is imported.
- **Demo account landmarks have no photos**; photos come from walk videos and photo uploads.
- **Street View suggestions** need `GOOGLE_MAPS_API_KEY` and are off in the reviewer keys.
- **Not built yet:** phone-number sign-in, recipient take-over mid-call from the app, push notifications, languages other than Hinglish and English for the voice, and automatic OSM import for new areas.

## For coding agents working in this repo

- Read `DESIGN.md` before visual or UI work: it defines fonts, colours, spacing and the aesthetic direction. Ask before departing from it, and flag code that doesn't match it.
- Run `pnpm test` and `pnpm typecheck` before handing back a change.
