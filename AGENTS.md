# Locus

Locus guides delivery riders to a recipient’s gate in Hinglish. The recipient saves a gate pin and landmarks in the web app. The guide API screens the caller, matches spoken clues against saved landmarks and nearby OpenStreetMap data, and returns the directions the voice worker speaks.

## Setup and verification

- Use Node.js 22+ and pnpm 10. Run `pnpm install --frozen-lockfile` from the repo root.
- Run `pnpm test` and `pnpm typecheck`. The API tests use an in-memory store and do not need service credentials. For a narrower check, run `pnpm --filter @locus/api test test/sessions.test.ts test/recipient.test.ts test/onboarding.test.ts test/walks.test.ts`.
- Follow [Run locally](README.md#run-locally) for the web app, API, worker, and Vobiz setup. Copy [.env.example](.env.example) to a root `.env` when you need local services. Keep service credentials in `.env` and out of tracked files and client code.
- Use the [live judging walkthrough](README.md#try-locus) to review the scripted replay, microphone test, or phone flow. Use a number you control when exercising phone calls.

## Where to look

| Area | Entry point |
|---|---|
| Web app, setup and call views | [`apps/web/app`](apps/web/app), [`apps/web/components`](apps/web/components) |
| Guide-session and recipient HTTP routes | [`apps/api/src/app.ts`](apps/api/src/app.ts), [`apps/api/src/recipientRoutes.ts`](apps/api/src/recipientRoutes.ts) |
| Screening, directions and handoff rules | [`apps/api/src/guide/engine.ts`](apps/api/src/guide/engine.ts) |
| LiveKit worker and phone call setup | [`apps/api/src/voice`](apps/api/src/voice), [`infra/livekit`](infra/livekit) |
| API tests and fixtures | [`apps/api/test`](apps/api/test) |
| Architecture | [Diagram](diagrams/architecture.html), [Implementation plan](plan.md) |

The web app and voice worker use the API for application data. Vobiz carries phone calls into and out of LiveKit. Sarvam supplies default speech and fallback matching, OpenAI processes walk media, and Supabase provides Auth, Postgres with PostGIS, and private media storage.

## Design system

Read [DESIGN.md](DESIGN.md) before UI work. Ask before departing from it, and flag any mismatch when reviewing or testing the UI.
