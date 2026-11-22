# Locus

Locus guides delivery riders to a recipient’s gate in Hinglish. The recipient saves a gate pin, an ordered set of landmarks, and the words to say at each stop. The Hono API screens the caller using the recipient’s first name and the delivery app, then matches spoken clues against saved landmarks and nearby OpenStreetMap data. The map shows the last matched place. It does not track a rider’s GPS.

The Next.js app and LiveKit worker use the API for application data. Vobiz carries phone calls over SIP. Sarvam supplies default speech, fallback matching, and landmark transliteration. OpenAI analyzes frames and photos during setup. Supabase supplies Google sign-in, Postgres with PostGIS, and private media storage.

## Choose what to verify

| Goal | Start here | Accounts or equipment |
|---|---|---|
| See the product in a minute | Open the [public replay](https://locus.ahmedfahim.dev/replay), select “Play the call”, and follow the map and transcript to the blue gate. This is a scripted example on real Bengaluru streets. | Browser with audio |
| Review the guide logic locally | Run the [credential-free checks](#1-install-and-run-credential-free-checks). | Node.js and pnpm |
| Talk to the guide now | Follow the [hosted browser walkthrough](README.md#test-the-live-guide-in-your-browser). The hosted app already has provider credentials. | Google account, microphone, and an international-format phone number for the profile |
| Reproduce the full flow locally | Follow sections 1–4 below. Add section 5 for actual telephone calls. | Your own Supabase, Google OAuth, Sarvam, OpenAI, and LiveKit configuration. Phone testing also needs Vobiz. |

If you’re evaluating from an automated environment without a browser, microphone, or provider access, run the credential-free checks and open the replay URL if available. Report replay, automated tests, browser calls, and real phone calls according to what you exercised. A successful HTTP response from a signed-in route only confirms that the page is reachable.

## 1. Install and run credential-free checks

Run from the repository root. Use Node.js 22 or later and the pnpm version pinned in [package.json](package.json).

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

The API suite uses Vitest and an in-memory store with fixture identities, geography, and provider responses. It covers the HTTP and guide behavior without needing a database, .env file, or paid credentials. The web test script has no unit suite. To target the main review scenarios, run:

```sh
pnpm --filter @locus/api test test/sessions.test.ts test/recipient.test.ts test/onboarding.test.ts test/walks.test.ts
```

| Review question | Evidence in the repo |
|---|---|
| Do callers need the recipient’s name and a delivery app before getting directions? | [Session tests](apps/api/test/sessions.test.ts) |
| Does a match advance the route, and do lost turns or a request for a person lead to handoff? | [Session tests](apps/api/test/sessions.test.ts) and [guide state machine](apps/api/src/guide/engine.ts) |
| Can a recipient save a profile, gate, and landmarks, and start a call only while expecting a delivery? | [Recipient tests](apps/api/test/recipient.test.ts) |
| How do map and media signals become reviewed landmarks? | [Onboarding tests](apps/api/test/onboarding.test.ts) and [walk tests](apps/api/test/walks.test.ts) |

## 2. Configure the local environment

Copy [.env.example](.env.example) to `.env` at the repository root if the file doesn’t already exist. Both the API and Next.js read that file. For a reproduction, use a test project you control. Put actual credentials directly into the local file and keep them out of commits, browser code, screenshots, and review transcripts. Restart the affected process when the file changes.

```sh
test -f .env || cp .env.example .env
```

### Supabase and Google sign-in

Create a project in the [Supabase dashboard](https://supabase.com/dashboard). Use the same project for all five values below.

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Open the project’s “Connect” dialog and copy the Session pooler connection string. Replace the password placeholder with the database password you set for the project. Percent-encode reserved characters in the password. Keep the pooler hostname, port, and username from the dialog. [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres) |
| `SUPABASE_URL` | Copy the project API URL from “Connect”. It looks like `https://PROJECT_REF.supabase.co`. Use this base URL without an API path. |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → Publishable key. Next.js exposes this value to the browser. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret key. The guide API uses this value to create and access the private `locus-walks` bucket on startup. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) |
| `SUPABASE_JWKS_URL` | Append `/auth/v1/.well-known/jwks.json` to `SUPABASE_URL`. Under Project Settings → JWT Keys, verify that the active signing key is ECC P-256 (ES256). Locus verifies ES256 user tokens for the `authenticated` audience and the same project issuer. [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys) |

In Google Cloud’s Google Auth Platform, configure the consent screen and create an OAuth client of type “Web application”. Add `http://localhost:3000` as an authorized JavaScript origin. Under “Authorized redirect URIs”, use the exact callback URL shown in Supabase’s Google provider settings, normally `https://PROJECT_REF.supabase.co/auth/v1/callback`. Enable Google in Supabase Auth → Sign In / Providers and paste the Google client ID and secret there. Those Google values live in Supabase’s provider settings. If the Google consent screen is in testing mode, add the reviewing Google account as a test user. [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

In Supabase Auth → URL Configuration, set the local project’s Site URL to `http://localhost:3000`. Add that URL and `http://localhost:3000/**` to the redirect allow list for local use. Locus passes the current page as the return URL, so the wildcard also covers sign-in from a direct link such as `/test-call`. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

### Sarvam, OpenAI, and local URLs

| Variable | Where to get it or what to set |
|---|---|
| `SARVAM_API_KEY` | Create a subscription key in API Keys on the Sarvam dashboard. Use an account with access to speech recognition, synthesis, transliteration, and the configured chat model. [Sarvam authentication](https://docs.sarvam.ai/api-reference/authentication) |
| `SARVAM_LLM_MODEL` | Keep `sarvam-105b-conversations` from the example for fallback clue matching. |
| `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER` | Keep `saaras:v4`, `bulbul:v4-flash`, and `simran_hi_conversation` for the standard voice configuration. |
| `LOCUS_SPEECH_PROVIDER`, `LOCUS_RESOLVER_PROVIDER` | Keep `sarvam` for the normal flow. If testing the OpenAI comparison path, `LOCUS_RESOLVER_PROVIDER=openai` uses `OPENAI_MODEL`, and `LOCUS_SPEECH_PROVIDER=openai` requires `OPENAI_STT_MODEL` and `OPENAI_TTS_MODEL` with model IDs enabled for your project. |
| `OPENAI_API_KEY` | Create a project API key from “API keys” in the OpenAI API Platform. The project needs API access and quota for the chosen model. [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart) |
| `OPENAI_VISION_MODEL`, `OPENAI_MODEL` | Choose a model with image inputs and structured outputs on the Responses API, for example `gpt-4.1-mini` if enabled for your project. Set `OPENAI_VISION_MODEL` explicitly or let it inherit `OPENAI_MODEL`. The API requires the OpenAI key and a vision model at startup even if you plan to enter landmarks manually. [Example model capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |
| `LOCUS_PORT`, `LOCUS_API_URL`, `LOCUS_WEB_ORIGIN` | Keep `8787`, `http://localhost:8787`, and `http://localhost:3000` respectively. If you change the port or hostname, update the API URL, browser origin, and auth redirect accordingly. The browser and worker both use `LOCUS_API_URL`. |
| `LOCUS_DEFAULT_LANGUAGE` | Keep `hi` for the Hinglish guide. |
| `OVERPASS_URL` | Optional. Set it to an Overpass interpreter endpoint you can reach if the importer’s default endpoint is busy. No API key is needed for the default endpoint. |
| `GOOGLE_MAPS_API_KEY` | Optional, for Street View suggestions. Create a key in a Google Cloud project with billing and the Street View Static API enabled. Maps and typed landmarks work with this unset. [Google Maps key setup](https://developers.google.com/maps/documentation/streetview/get-api-key) |

For a local replay-only run, fill just `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and run `pnpm --filter @locus/web dev`. Open `http://localhost:3000/replay`. The replay needs those values because the shared web configuration requires them at startup. It does not use Google sign-in, the guide API, or a call worker.

## 3. Migrate the database and start the app

Install FFmpeg through your system package manager and check that both binaries are on `PATH`. The API uses them to process walk media. The database migration enables PostGIS and creates the app schema.

```sh
ffmpeg -version
ffprobe -version
pnpm --filter @locus/api db:migrate
pnpm --filter @locus/api osm:import 13.038 77.594 700
```

The import arguments are latitude, longitude, and radius in metres. The example covers part of Bengaluru. Use your gate’s coordinates if you want map suggestions and geographically grounded matching for another neighbourhood. Success prints counts for named places and roads. If Overpass is unavailable, you can continue with manually entered landmarks while resolving the import.

Start the API and web app in separate terminals, both from the repository root.

```sh
pnpm --filter @locus/api dev
```

```sh
pnpm --filter @locus/web dev
```

The API logs a `listening` event and the configured port. An unauthenticated request to `/me` should return HTTP 401 with “Sign in again”. This verifies the API responds and enforces authentication. To verify the database and Auth together, open `http://localhost:3000`, sign in with Google, save the test profile and route, and reload Home to see them persisted.

```sh
curl -i http://localhost:8787/me
```

For a repeatable setup, use two distinct landmarks on the approach to a gate in India. Enter a short direction on each cue and place the last cue at the gate to test arrival by naming it. You can skip camera and location permissions by manually placing the pin and cues. For a media test, upload a few street photos or record a geotagged walk on a device with camera and location permissions. Check the proposals before saving the route. Remote devices need an HTTPS origin for browser media permissions.

## 4. Enable browser voice calls

| Variable | Where to get it |
|---|---|
| `LIVEKIT_URL` | Copy the WebSocket Project URL from LiveKit Cloud → Project Settings. It starts with `wss://`. [LiveKit Project URL](https://docs.livekit.io/intro/basics/connect/) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Create a key and secret under “API Keys” for the same LiveKit project. Save the secret when it’s displayed. Both the API and worker use these credentials. [LiveKit API keys](https://docs.livekit.io/reference/api/projects/keys/) |
| `LOCUS_WORKER_API_KEY` | Run the repo command below against the migrated Locus database. It prints a first-party key once. Put that key in the root `.env`. This key lets the worker call the guide API and is separate from the LiveKit credentials. |

```sh
pnpm --filter @locus/api admin client locus-worker --first-party
```

Restart the API after adding the LiveKit variables. Start the worker in its own terminal.

```sh
pnpm --filter @locus/api worker dev
```

For a browser-only test on the same machine, you can also run `livekit-server --dev` in a separate terminal and set `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`, and `LIVEKIT_API_SECRET=secret`. Those are the public defaults of LiveKit’s local development mode. [Local LiveKit setup](https://docs.livekit.io/transport/self-hosting/local/)

The worker registers as `locus-guide`. Finish setup and switch on “Expecting a delivery”. Choose “Try a call” → “Start call”, allow the microphone, and use your profile’s first name and delivery app in the [browser walkthrough](README.md#test-the-live-guide-in-your-browser). A working call speaks a greeting, asks for a clue after screening, and shows the transcript and matched stop. Browser calls use a recipient ID in a LiveKit token issued by the API. A Vobiz number and a SIP trunk are unnecessary for this stage.

## 5. Enable Vobiz phone calls and handoff

Use this section if reviewing the actual phone network path. You need a Vobiz number and SIP trunk you control, a LiveKit Cloud project, and the LiveKit CLI (`lk`) configured for that same project. Provisioning can require carrier verification and funded service. The media path is Vobiz → LiveKit SIP → `locus-guide`. Outbound rider calls and handoffs use the reverse path. [Vobiz’s LiveKit guide](https://www.vobiz.ai/integrations/livekit/) · [LiveKit SIP setup](https://docs.livekit.io/telephony/start/sip-trunk-setup/) · [LiveKit CLI project setup](https://docs.livekit.io/reference/developer-tools/livekit-cli/projects/)

1. In Vobiz, route the Locus number to the SIP URI shown in LiveKit Project Settings. Use the SIP address for carrier routing and the WebSocket Project URL for `LIVEKIT_URL`.
2. Copy the [inbound trunk template](infra/livekit/inbound-trunk.json) and [dispatch rule template](infra/livekit/dispatch-rule.json) to `inbound-trunk.local.json` and `dispatch-rule.local.json` in the same directory. Put the Vobiz number in the inbound trunk’s `numbers` array. Create the trunk first and copy its ID into the dispatch rule’s `trunk_ids`. Leave the dispatch agent name as `locus-guide`.

   ```sh
   lk sip inbound create infra/livekit/inbound-trunk.local.json
   lk sip dispatch create infra/livekit/dispatch-rule.local.json
   ```

3. Assign the number to the test recipient after saving their profile. Find the reviewer’s Auth user ID under Authentication → Users in the test Supabase project. In SQL Editor, run the read-only lookup below with that user ID. The returned `rcp_…` value is the Locus recipient ID.

   ```sql
   select id from locus.recipients
   where "authSubject" = 'YOUR_SUPABASE_AUTH_USER_ID';
   ```

   ```sh
   pnpm --filter @locus/api admin number +91XXXXXXXXXX YOUR_LOCUS_RECIPIENT_ID vobiz
   ```

4. For outbound calls, open Vobiz Console → SIP Trunk → Outbound Trunks. Copy the outbound SIP domain, username, and password to `VOBIZ_SIP_DOMAIN`, `VOBIZ_SIP_USERNAME`, and `VOBIZ_SIP_PASSWORD`. Use the domain from the trunk without the `sip:` prefix. Replace the example number below with your own Vobiz number in E.164 format.

   ```sh
   pnpm --filter @locus/api admin trunk +91XXXXXXXXXX
   pnpm --filter @locus/api admin outbound +91XXXXXXXXXX
   ```

   The first command creates a LiveKit outbound trunk and prints the values for `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` and `LOCUS_OUTBOUND_NUMBER`. Save them to `.env`. The second registers the number for loop protection. Leave `LOCUS_DEV_DID` blank for the normal phone and browser flows. Restart the API and worker.

5. Turn on “Expecting a delivery”. Dial the Locus number from a separate phone, pass screening, then say “Customer se baat karao”. Answer the call on the recipient phone and check that both phones can hear each other. If you decline the handoff, the rider should hear the profile’s fallback note. Also test “Call the rider” from the web after entering a test `+91` number you control.

## Troubleshooting

| Symptom | Check |
|---|---|
| A command reports a missing variable | Verify the name in the root `.env`, confirm it has a value, and restart the affected process. The key sources above apply to one test project per provider. |
| Database connection fails | Use the Session pooler connection string and the database password for that project. Check percent encoding and try the migration before starting the API. |
| Google redirects to the wrong place | Check the Google OAuth callback and the Supabase app redirect allow list separately. Sign in again after changing the active JWT signing key. |
| `/me` returns 401 after a successful login | Confirm the dashboard’s active signing algorithm is ES256 and that the URL, publishable key, and JWKS all point at the same project. |
| Storage fails on startup | Verify the server-only Supabase secret and check the API startup output for the bucket error. |
| Map suggestions are sparse | Import around the gate’s exact coordinates and check the importer’s counts. Typed landmarks can still be used to test the basic guide. |
| “Start call” fails or Locus never picks up | Save a profile and route, turn on “Expecting a delivery”, and verify mic permission. Check the API’s LiveKit configuration and that the `locus-guide` worker is registered in the same project. Review worker and API logs for that call. |
| “Call the rider” is absent or a handoff fails | Check the outbound trunk ID, caller number, Vobiz SIP credentials, and restart after changing env values. For inbound calls, verify Vobiz origination, the LiveKit inbound trunk, the dispatch rule, and the number’s Locus recipient assignment. |

## Where to look

| Area | Entry point |
|---|---|
| Web app, setup and call views | [Next.js routes](apps/web/app), [Components](apps/web/components) |
| Guide-session and recipient HTTP routes | [Guide API](apps/api/src/app.ts), [Recipient routes](apps/api/src/recipientRoutes.ts) |
| Screening, directions and handoff rules | [Guide state machine](apps/api/src/guide/engine.ts) |
| LiveKit worker and phone configuration | [Voice worker and clients](apps/api/src/voice), [SIP templates](infra/livekit) |
| Geography and landmark enrichment | [OSM and road graph](apps/api/src/geo), [Media enrichment](apps/api/src/enrich), [Route setup](apps/api/src/onboarding) |
| Architecture and implementation | [Architecture diagram](diagrams/architecture.html), [Implementation plan](plan.md) |

## Design system

Read [DESIGN.md](DESIGN.md) before UI work. Ask before departing from it, and flag any mismatch when reviewing or testing the UI.
