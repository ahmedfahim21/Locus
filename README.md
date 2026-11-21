# Locus

Locus answers delivery calls in Hinglish and talks riders to your door, one landmark at a time.

## Screenshots

| Guiding the rider | Arrival in 3D |
|:---:|:---:|
| <img src="screenshots/replay.webp" alt="A map and Hinglish transcript guide the rider from the wrong gate toward the medical store" width="520"> | <img src="screenshots/arrival.webp" alt="A 3D map shows the completed route and the rider arriving at the blue gate" width="520"> |

The scripted replay uses real streets in Hebbal, Bengaluru, with sample landmarks.

## What it does

- Pin your gate and record the walk from the main road. Review the suggested landmarks and directions.
- Turn on “Expecting a delivery” and give the rider your Locus number.
- Locus listens for what the rider can see, places them on the route, and gives the next direction. It can call the recipient if the rider is stuck.
- Try a voice call in the browser and follow the route and transcript as the call progresses.

## Architecture

[![Architecture showing the call path through LiveKit and the voice worker, the Hono guide API, and the recipient web app and its data services](diagrams/architecture.webp)](diagrams/architecture.html)

[Open the standalone HTML diagram](diagrams/architecture.html).

## Run locally

With Node.js 22+ and pnpm 10, copy [.env.example](.env.example) to `.env` at the repo root and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the web app.

```bash
pnpm install
pnpm --filter @locus/web dev
```

Open `http://localhost:3000/replay` to hear the scripted demo without signing in or starting the API.

For recipient setup, configure Supabase Google sign-in and add `http://localhost:3000` to the allowed redirect URLs. Fill in the API settings from `.env.example`, add `SUPABASE_SECRET_KEY` for Storage, and install FFmpeg (including `ffprobe`).

```bash
pnpm --filter @locus/api db:migrate
pnpm --filter @locus/api osm:import 13.038 77.594 700
pnpm --filter @locus/api dev
```

Use the gate’s coordinates for the OSM import. For browser test calls, set the LiveKit credentials and run `pnpm --filter @locus/api admin client locus-worker --first-party`. Save the printed key as `LOCUS_WORKER_API_KEY`, then run `pnpm --filter @locus/api worker dev` in a separate terminal. Phone calls also use a Plivo SIP trunk and a Locus number assigned to the recipient.

```bash
pnpm test
pnpm typecheck
```
