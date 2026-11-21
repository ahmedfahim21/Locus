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

export function createSpeech(provider: SpeechProvider, language: CallLanguage): { stt: stt.STT; tts: tts.TTS } {
  if (provider === "sarvam") {
    const apiKey = env("SARVAM_API_KEY");
    return {
      stt: new sarvam.STT({
        apiKey,
        model: "saaras:v3",
        // Riders mix Hindi, English and local words; let Saaras detect and keep the mix.
        languageCode: "unknown",
        mode: "codemix",
      }),
      tts: new sarvam.TTS({
        apiKey,
        model: "bulbul:v3",
        speaker: optionalEnv("SARVAM_TTS_SPEAKER") ?? "simran",
        targetLanguageCode: language === "hi" ? "hi-IN" : "en-IN",
      }),
    };
  }
  return {
    stt: new openai.STT({ model: env("OPENAI_STT_MODEL"), language: language === "hi" ? "hi" : "en" }),
    tts: new openai.TTS({ model: env("OPENAI_TTS_MODEL"), voice: "coral" }),
  };
}
