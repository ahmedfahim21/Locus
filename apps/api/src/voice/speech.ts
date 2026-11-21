/**
 * Speech-to-text and text-to-speech for the call worker. Sarvam is the default
 * (Saaras for Hinglish/code-mixed speech, Bulbul for Indian voices); OpenAI is
 * kept so the Day-1 latency spike can compare both on a real call.
 */
import type { stt, tts } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as sarvam from "@livekit/agents-plugin-sarvam";
import { env, optionalEnv } from "../config.js";

export type SpeechProvider = "sarvam" | "openai";
export type CallLanguage = "hi" | "en";

export function speechProvider(): SpeechProvider {
  const p = optionalEnv("LOCUS_SPEECH_PROVIDER") ?? "sarvam";
  if (p !== "sarvam" && p !== "openai") throw new Error(`LOCUS_SPEECH_PROVIDER must be sarvam or openai, got ${p}`);
  return p;
}

/**
 * `keyterms` are this call's names and places (from the guide API). Saaras v4 listens
 * for them: on phone audio it otherwise hears "Fahim" as "bahin" and "Kohenur" as "Kohinoor".
 */
export function createSpeech(provider: SpeechProvider, language: CallLanguage, keyterms: string[] = []): { stt: stt.STT; tts: tts.TTS } {
  if (provider === "sarvam") {
    const apiKey = env("SARVAM_API_KEY");
    return {
      stt: new sarvam.STT({
        apiKey,
        model: (optionalEnv("SARVAM_STT_MODEL") ?? "saaras:v4") as "saaras:v4",
        // Riders mix Hindi, English and local words; let Saaras detect and keep the mix.
        languageCode: "unknown",
        mode: "codemix",
        // Sent by our pnpm patch of the plugin (patches/@livekit__agents-plugin-sarvam@1.10.1.patch).
        keyterms,
      }),
      tts: new sarvam.TTS({
        apiKey,
        // The plugin types only list v2/v3; v4-flash accepts the same request fields (verified against the API).
        model: (optionalEnv("SARVAM_TTS_MODEL") ?? "bulbul:v4-flash") as "bulbul:v3",
        speaker: optionalEnv("SARVAM_TTS_SPEAKER") ?? "simran_hi_conversation",
        targetLanguageCode: language === "hi" ? "hi-IN" : "en-IN",
      }),
    };
  }
  return {
    stt: new openai.STT({ model: env("OPENAI_STT_MODEL"), language: language === "hi" ? "hi" : "en" }),
    tts: new openai.TTS({ model: env("OPENAI_TTS_MODEL"), voice: "coral" }),
  };
}
