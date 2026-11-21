/**
 * Locus's call worker: a LiveKit Agents worker that answers rider calls arriving
 * over the SIP trunk. It has no LLM of its own: every finished rider turn goes
 * to the guide-session API, and the worker speaks the instruction it returns.
 *
 *   pnpm --filter @locus/api worker dev     (local, connects to LIVEKIT_URL)
 *   pnpm --filter @locus/api worker start   (production)
 *
 * Without a phone number: set LOCUS_DEV_DID to a number assigned to a recipient
 * (`admin number`). A participant with no SIP attributes (the agents playground,
 * or `pnpm voice:rider`) is then treated as a call to that number.
 */
import { fileURLToPath } from "node:url";
import {
  cli,
  defineAgent,
  ServerOptions,
  voice,
  type JobContext,
  type JobProcess,
  type llm,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { SipClient } from "livekit-server-sdk";
import { env, optionalEnv } from "../config.js";
import { GuideClient, type GuideReply } from "./guideClient.js";
import { createSpeech, speechProvider } from "./speech.js";

/** A rider turn counts as silence after this long with no speech (lost-turn rule, plan §4.2). */
const SILENCE_MS = 8_000;
/** Handoff call rings for this long before Locus plays the fallback note (plan §4.3). */
const HANDOFF_RING_SECONDS = 20;
/** Pause after the last words before hanging up, so the phone network doesn't clip them. */
const HANG_UP_GRACE_MS = 1_000;

type Language = "hi" | "en";

const REFUSALS: Record<string, Record<Language, string>> = {
  NUMBER_NOT_SET_UP: { hi: "Yeh number abhi set up nahi hai.", en: "This number isn't set up yet." },
  DELIVERY_NOT_EXPECTED: {
    hi: "Woh abhi kisi delivery ka intezaar nahi kar rahe. Kripya unhe seedha call kijiye.",
    en: "They aren't expecting a delivery right now. Please call them directly.",
  },
  HOME_NOT_SET_UP: { hi: "Yeh number abhi set up nahi hai.", en: "This number isn't set up yet." },
};

const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

class GuideAgent extends voice.Agent {
  private silenceTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly ctx: JobContext,
    private readonly guide: GuideClient,
    private readonly sessionId: string,
    private readonly greeting: string,
  ) {
    super({ instructions: "Speak only the exact text you are given." });
  }

  override async onEnter(): Promise<void> {
    this.session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.oldState === "speaking" && ev.newState === "listening") this.armSilenceTimer();
    });
    this.session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === "speaking") this.clearSilenceTimer();
    });
    this.session.say(this.greeting, { allowInterruptions: false });
  }

  override async onUserTurnCompleted(_chatCtx: llm.ChatContext, message: llm.ChatMessage): Promise<void> {
    const text = message.textContent?.trim();
    if (text) void this.step(() => this.guide.utterance(this.sessionId, text));
    // The guide API decides what Locus says; never let the session generate its own reply.
    throw new voice.StopResponse();
  }

  private armSilenceTimer() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => void this.step(() => this.guide.silence(this.sessionId)), SILENCE_MS);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  /** Runs one API call, speaks the reply, and follows up on terminal states. Errors end the call loudly. */
  private async step(call: () => Promise<GuideReply>) {
    if (this.busy) return;
    this.busy = true;
    this.clearSilenceTimer();
    const started = Date.now();
    try {
      const reply = await call();
      log({ event: "worker.turn", sessionId: this.sessionId, state: reply.state, apiMs: Date.now() - started });
      const speech = this.session.say(reply.instruction);
      if (reply.state === "handoff") {
        await speech.waitForPlayout();
        await this.handoff(reply.handoffPhone);
      } else if (reply.state === "arrived" || reply.state === "ended") {
        await speech.waitForPlayout();
        await this.hangUp();
      }
    } catch (err) {
      log({ event: "worker.error", sessionId: this.sessionId, message: (err as Error).message, stack: (err as Error).stack });
      throw err;
    } finally {
      this.busy = false;
    }
  }

  private async handoff(phone: string | undefined) {
    if (!phone) throw new Error(`Session ${this.sessionId} entered handoff without a handoffPhone (client not first-party?)`);
    const sip = new SipClient(env("LIVEKIT_URL"), env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"));
    let answered = false;
    try {
      // Read here, not at start: dev calls without a SIP trunk work until a handoff is needed.
      await sip.createSipParticipant(env("LIVEKIT_SIP_OUTBOUND_TRUNK_ID"), phone, this.ctx.room.name!, {
        fromNumber: env("LOCUS_OUTBOUND_NUMBER"),
        participantIdentity: "recipient",
        ringingTimeout: HANDOFF_RING_SECONDS,
        waitUntilAnswered: true,
      });
      answered = true;
    } catch (err) {
      log({ event: "worker.handoffNotAnswered", sessionId: this.sessionId, message: (err as Error).message });
    }
    const reply = await this.guide.handoffResult(this.sessionId, answered);
    const speech = this.session.say(reply.instruction);
    await speech.waitForPlayout();
    if (answered) {
      // Rider and recipient are now in the same room; Locus leaves the conversation.
      await this.session.close();
    } else {
      await this.hangUp();
    }
  }

  private async hangUp() {
    await new Promise((resolve) => setTimeout(resolve, HANG_UP_GRACE_MS));
    await this.guide.end(this.sessionId);
    await this.ctx.deleteRoom();
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const guide = new GuideClient(env("LOCUS_API_URL"), env("LOCUS_WORKER_API_KEY"));
    const language = (optionalEnv("LOCUS_DEFAULT_LANGUAGE") ?? "hi") as Language;

    await ctx.connect();
    const caller = await ctx.waitForParticipant();
    const devDid = optionalEnv("LOCUS_DEV_DID");
    const sipDid = caller.attributes["sip.trunkPhoneNumber"];
    const did = sipDid ?? devDid;
    const callerId = caller.attributes["sip.phoneNumber"] ?? (sipDid ? undefined : `dev:${caller.identity}`);
    if (!did) throw new Error(`Participant ${caller.identity} has no sip.trunkPhoneNumber attribute and LOCUS_DEV_DID is unset`);
    if (!sipDid) log({ event: "worker.devCall", did, participant: caller.identity });

    const created = await guide.createSession(did, callerId, language);
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      ...createSpeech(speechProvider(), language),
    });

    if (!created.ok) {
      log({ event: "worker.refused", did, code: created.code });
      if (created.code === "LOOP_REJECTED") {
        await ctx.deleteRoom();
        return;
      }
      const line = REFUSALS[created.code]?.[language];
      if (!line) throw new Error(`No spoken line for refusal ${created.code}`);
      await session.start({ agent: new voice.Agent({ instructions: "Say only the given text." }), room: ctx.room });
      await session.say(line, { allowInterruptions: false }).waitForPlayout();
      await ctx.deleteRoom();
      return;
    }

    log({ event: "worker.session", sessionId: created.sessionId });
    const agent = new GuideAgent(ctx, guide, created.sessionId, created.instruction);
    await session.start({ agent, room: ctx.room });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: "locus-guide" }));
