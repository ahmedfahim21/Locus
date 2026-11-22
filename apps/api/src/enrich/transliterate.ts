import { languageOfScript, type LocalLanguage } from "../geo/region.js";

const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Whether a typed landmark's script names suit a door in this state: a Hindi name, the
 * state's language where it has one, and nothing in another state's script (the door
 * moved, or the names predate per-state languages).
 */
export function namesFitState(names: string[], local: LocalLanguage | null): boolean {
  return (
    names.some((n) => DEVANAGARI.test(n)) &&
    names.every((n) => DEVANAGARI.test(n) || languageOfScript(n) === local) &&
    (!local || names.some((n) => local.script.test(n)))
  );
}

/**
 * A landmark the recipient typed, spelled in Hindi (Devanagari) and the home state's
 * script (Telugu, Kannada), for riders and for the stamps. Spelled as it sounds, not
 * translated: riders say "Knowledge City", so it's "नॉलेज सिटी", not "ज्ञान नगरी".
 */
export interface NameTransliterator {
  transliterate(name: string, local: LocalLanguage | null): Promise<{ hi: string; local: string | null }>;
}

/** Sarvam's transliterate API (Roman to Indic scripts). */
export class SarvamTransliterator implements NameTransliterator {
  constructor(
    private readonly apiKey: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  private async one(input: string, target: string): Promise<string> {
    const res = await fetch("https://api.sarvam.ai/transliterate", {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ input, source_language_code: "en-IN", target_language_code: target }),
    });
    if (!res.ok) throw new Error(`Sarvam transliterate returned ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { transliterated_text?: string };
    const text = body.transliterated_text?.trim();
    if (!text) throw new Error("Sarvam transliterate returned no text");
    return text;
  }

  async transliterate(name: string, local: LocalLanguage | null) {
    const started = Date.now();
    const [hi, localName] = await Promise.all([this.one(name, "hi-IN"), local ? this.one(name, local.sarvam) : Promise.resolve(null)]);
    this.log({ event: "transliterate.call", provider: "sarvam", local: local?.code ?? null, ms: Date.now() - started });
    return { hi, local: localName };
  }
}
