/**
 * Renders the landing page's demo call (apps/web/public/replay/wrong-gate.mp3) with
 * Sarvam Bulbul from apps/web/lib/demoDialogue.json, and writes each line's start
 * time back into that file so the transcript follows the audio exactly. The rider is
 * passed through a phone-line band so he sounds like he's on a call. Needs ffmpeg.
 *
 *   pnpm --filter @locus/api demo:audio                       render with the voices in the JSON
 *   pnpm --filter @locus/api demo:audio --rider=<id> --locus=<id>   switch voices (saved to the JSON)
 *   pnpm --filter @locus/api demo:audio --audition            one file per candidate voice in /tmp/locus-voices
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { env } from "../config.js";

const run = promisify(execFile);
const DIALOGUE = fileURLToPath(new URL("../../../web/lib/demoDialogue.json", import.meta.url));
const OUT = fileURLToPath(new URL("../../../web/public/replay/wrong-gate.mp3", import.meta.url));
const RATE = 24000;
/** A phone line carries roughly 300–3400 Hz. */
const PHONE = "highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=3,volume=1.4";
const CANDIDATES = {
  rider: ["rahul_hi_conversational", "kabir_hi_conversational", "mohit_hi_conversational", "aditya_hi_conversational", "tarun_hi_conversational"],
  locus: ["simran_hi_conversation", "ritu_hi_customer_warm", "kavya_hi_conversational", "ishita_enhi_customer_expressive", "sarika_hi_conversation"],
};

type Turn = { speaker: "rider" | "locus"; text: string; reached: number; arrived?: boolean; pauseBefore: number; time: number };
type Dialogue = { voices: { rider: string; locus: string }; turns: Turn[] };

async function speak(text: string, speaker: string): Promise<Buffer> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": env("SARVAM_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ text, target_language_code: "hi-IN", model: "bulbul:v4-flash", speaker, pace: 1.0, temperature: 0.7, speech_sample_rate: RATE }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS (${speaker}) returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { audios?: string[] };
  if (!body.audios?.length) throw new Error(`Sarvam TTS (${speaker}) returned no audio`);
  return Buffer.concat(body.audios.map((a) => Buffer.from(a, "base64")));
}

/** Clip → 24 kHz mono WAV, the rider through the phone band. */
async function normalise(input: string, output: string, phone: boolean) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, ...(phone ? ["-af", PHONE] : []), "-ar", String(RATE), "-ac", "1", output]);
}

async function seconds(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim());
}

async function silence(file: string, s: number) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=mono`, "-t", s.toFixed(2), file]);
}

const dialogue = JSON.parse(await readFile(DIALOGUE, "utf8")) as Dialogue;
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = await mkdtemp(join(tmpdir(), "locus-demo-"));

try {
  if (process.argv.includes("--audition")) {
    const out = join(tmpdir(), "locus-voices");
    await mkdir(out, { recursive: true });
    for (const role of ["rider", "locus"] as const) {
      const lines = dialogue.turns.filter((t) => t.speaker === role).slice(0, 2).map((t) => t.text).join(" ");
      for (const voice of CANDIDATES[role]) {
        const raw = join(dir, `${voice}.wav`);
        await writeFile(raw, await speak(lines, voice));
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, ...(role === "rider" ? ["-af", PHONE] : []), join(out, `${role}-${voice}.mp3`)]);
        console.log(`${role}: ${join(out, `${role}-${voice}.mp3`)}`);
      }
    }
  } else {
    dialogue.voices = { rider: arg("rider") ?? dialogue.voices.rider, locus: arg("locus") ?? dialogue.voices.locus };
    const parts: string[] = [];
    let at = 0;
    for (const [i, turn] of dialogue.turns.entries()) {
      if (turn.pauseBefore > 0) {
        const gap = join(dir, `gap-${i}.wav`);
        await silence(gap, turn.pauseBefore);
        parts.push(gap);
        at += await seconds(gap);
      }
      const raw = join(dir, `raw-${i}.wav`);
      const clip = join(dir, `line-${i}.wav`);
      await writeFile(raw, await speak(turn.text, dialogue.voices[turn.speaker]));
      await normalise(raw, clip, turn.speaker === "rider");
      turn.time = Math.round(at * 100) / 100;
      parts.push(clip);
      at += await seconds(clip);
      console.log(`${turn.time.toFixed(2)}s  ${turn.speaker.padEnd(5)}  ${turn.text}`);
    }
    const list = join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-ar", String(RATE), "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", OUT]);
    await writeFile(DIALOGUE, `${JSON.stringify(dialogue, null, 2)}\n`);
    console.log(`\n${at.toFixed(1)} s, rider ${dialogue.voices.rider}, Locus ${dialogue.voices.locus} -> ${OUT}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
