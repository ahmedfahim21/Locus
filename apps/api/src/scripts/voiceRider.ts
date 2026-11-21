/**
 * A scripted rider for testing the call worker without a phone line. It joins a
 * LiveKit room (dispatching the `locus-guide` worker into it), speaks each line
 * in a Sarvam voice after Locus finishes talking, records every Locus reply to a
 * WAV file, and transcribes it with Sarvam speech-to-text.
 *
 *   livekit-server --dev                              # local LiveKit (devkey / secret)
 *   pnpm --filter @locus/api start                    # the API
 *   pnpm --filter @locus/api worker dev               # the worker, with LOCUS_DEV_DID set
 *   pnpm --filter @locus/api voice:rider [out dir] -- "line 1" "line 2" ...
 *
 * Also prints a token for joining the same kind of room from the LiveKit agents
 * playground with your own microphone (`--token`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { env, optionalEnv } from "../config.js";
import { TEST_CALL_RECIPIENT_ATTR } from "../voice/testCall.js";

const RATE = 16_000;
const FRAME = RATE / 100; // 10 ms
/** Locus has finished a reply after this much quiet. */
const END_OF_REPLY_MS = 1_400;
/** Give up waiting for Locus to start talking after this long. */
const REPLY_TIMEOUT_MS = 30_000;
const SPEECH_RMS = 500;

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const lines = sep >= 0 ? args.slice(sep + 1) : [];
const flags = sep >= 0 ? args.slice(0, sep) : args;
const recipientFlag = flags.indexOf("--recipient");
/** Join as a browser test call for this recipient (same token attribute the web app's test call carries). */
const testRecipient = recipientFlag >= 0 ? flags[recipientFlag + 1] : undefined;
const outDir = flags.find((a, i) => !a.startsWith("--") && i !== recipientFlag + 1) ?? "voice-run";
const room = `rider-${Date.now()}`;

async function token(identity: string) {
  const at = new AccessToken(env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"), {
    identity,
    ttl: "1h",
    ...(testRecipient ? { attributes: { [TEST_CALL_RECIPIENT_ATTR]: testRecipient } } : {}),
  });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: "locus-guide" })] });
  return at.toJwt();
}

if (flags.includes("--token")) {
  console.log(JSON.stringify({ url: env("LIVEKIT_URL"), room, token: await token("you") }));
  process.exit(0);
}
if (lines.length === 0) throw new Error('Give the rider\'s lines after --, e.g. -- "Ahmed ke liye, Swiggy" "Petrol pump pe hoon"');

async function tts(text: string): Promise<Int16Array> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": env("SARVAM_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      speaker: optionalEnv("RIDER_TTS_SPEAKER") ?? "aditya",
      model: "bulbul:v3",
      speech_sample_rate: RATE,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS returned ${res.status}: ${await res.text()}`);
  const { audios } = (await res.json()) as { audios: string[] };
  const wav = Buffer.from(audios[0]!, "base64");
  const data = wav.indexOf("data");
  if (data < 0) throw new Error("Sarvam TTS returned audio without a WAV data chunk");
  const pcm = wav.subarray(data + 8);
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}

function wavFile(samples: Int16Array): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

async function stt(wav: Buffer): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "reply.wav");
  form.append("model", "saaras:v3");
  form.append("mode", "codemix");
  form.append("language_code", "unknown");
  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": env("SARVAM_API_KEY") },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam STT returned ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { transcript: string }).transcript;
}

/** Collects Locus's audio and resolves each reply once it goes quiet. */
class ReplyListener {
  private current: Int16Array[] = [];
  private speaking = false;
  private quietMs = 0;
  private waiter: ((samples: Int16Array) => void) | null = null;
  /** When the current reply's first loud frame arrived. */
  startedAt = 0;

  feed(frame: AudioFrame) {
    const d = frame.data;
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i]! * d[i]!;
    const loud = Math.sqrt(sum / d.length) > SPEECH_RMS;
    const ms = (frame.samplesPerChannel / frame.sampleRate) * 1000;
    if (loud) {
      if (!this.speaking) this.startedAt = Date.now();
      this.speaking = true;
      this.quietMs = 0;
    } else if (this.speaking) {
      this.quietMs += ms;
    }
    if (this.speaking) this.current.push(new Int16Array(d));
    if (this.speaking && this.quietMs >= END_OF_REPLY_MS) {
      const total = this.current.reduce((n, c) => n + c.length, 0);
      const out = new Int16Array(total);
      let at = 0;
      for (const c of this.current) {
        out.set(c, at);
        at += c.length;
      }
      this.current = [];
      this.speaking = false;
      this.quietMs = 0;
      this.waiter?.(out);
      this.waiter = null;
    }
  }

  /** Locus left the room: whatever it was saying counts as its last reply. */
  flush() {
    if (this.current.length === 0) return;
    this.quietMs = END_OF_REPLY_MS;
    this.feed(new AudioFrame(new Int16Array(FRAME), RATE, 1, FRAME));
  }

  next(): Promise<Int16Array | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve(null);
      }, REPLY_TIMEOUT_MS);
      this.waiter = (s) => {
        clearTimeout(timer);
        resolve(s);
      };
    });
  }
}

mkdirSync(outDir, { recursive: true });
const rider = new Room();
const listener = new ReplyListener();
rider.on(RoomEvent.Disconnected, () => listener.flush());
rider.on(RoomEvent.ParticipantDisconnected, () => listener.flush());
rider.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  console.log(JSON.stringify({ step: "locus joined", participant: participant.identity }));
  void (async () => {
    for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) listener.feed(frame);
    listener.flush();
  })();
});

await rider.connect(env("LIVEKIT_URL"), await token("rider"), { autoSubscribe: true, dynacast: false });
const source = new AudioSource(RATE, 1);
const track = LocalAudioTrack.createAudioTrack("rider-mic", source);
await rider.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
console.log(JSON.stringify({ step: "rider in room", room }));

async function speak(samples: Int16Array) {
  for (let i = 0; i < samples.length; i += FRAME) {
    const chunk = new Int16Array(FRAME);
    chunk.set(samples.subarray(i, i + FRAME));
    await source.captureFrame(new AudioFrame(chunk, RATE, 1, FRAME));
  }
  // A little silence so voice activity detection sees the end of the turn.
  for (let i = 0; i < 50; i++) await source.captureFrame(new AudioFrame(new Int16Array(FRAME), RATE, 1, FRAME));
  await source.waitForPlayout();
}

const transcript: { speaker: string; text: string }[] = [];
const gaps: number[] = [];
async function hearReply(n: number): Promise<boolean> {
  const reply = await listener.next();
  if (!reply) {
    console.log(JSON.stringify({ step: "no reply from Locus", turn: n }));
    return false;
  }
  const wav = wavFile(reply);
  writeFileSync(join(outDir, `locus-${n}.wav`), wav);
  const text = await stt(wav);
  transcript.push({ speaker: "locus", text });
  console.log(JSON.stringify({ speaker: "locus", text, seconds: +(reply.length / RATE).toFixed(1) }));
  return true;
}

let turn = 0;
const greeted = await hearReply(turn++);
for (const line of lines) {
  if (!greeted && turn === 1) break;
  const started = Date.now();
  await speak(await tts(line));
  const riderDone = Date.now();
  transcript.push({ speaker: "rider", text: line });
  console.log(JSON.stringify({ speaker: "rider", text: line }));
  const ok = await hearReply(turn++);
  // Rider stopped talking → Locus started talking (includes the 0.5 s of trailing silence we send).
  const responseMs = ok ? listener.startedAt - riderDone : null;
  if (responseMs !== null) gaps.push(responseMs);
  console.log(JSON.stringify({ step: "turn", turn: turn - 1, responseMs, msFromRiderStartToReplyEnd: Date.now() - started }));
  if (!ok) break;
}
writeFileSync(join(outDir, "transcript.json"), JSON.stringify(transcript, null, 2));
const sorted = [...gaps].sort((a, b) => a - b);
console.log(JSON.stringify({ step: "done", outDir, turns: transcript.length, responseMs: { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) } }));
await rider.disconnect();
process.exit(transcript.filter((t) => t.speaker === "locus").length === lines.length + 1 ? 0 : 1);
