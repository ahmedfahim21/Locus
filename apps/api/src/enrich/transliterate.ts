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
 * Names for a landmark the recipient typed in English, for riders and for the stamps:
 * Hindi always, plus the home state's language (Telugu, Kannada) where there is one.
 */
export interface NameTranslator {
  translate(name: string, local: LocalLanguage | null): Promise<{ hi: string; local: string | null }>;
}

/** Sarvam's translate API (sarvam-translate:v1). */
export class SarvamTranslator implements NameTranslator {
  constructor(
    private readonly apiKey: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  private async one(input: string, target: string): Promise<string> {
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ input, source_language_code: "en-IN", target_language_code: target, model: "sarvam-translate:v1" }),
    });
    if (!res.ok) throw new Error(`Sarvam translate returned ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { translated_text?: string };
    const text = body.translated_text?.trim();
    if (!text) throw new Error("Sarvam translate returned no text");
    return text;
  }

  async translate(name: string, local: LocalLanguage | null) {
    const started = Date.now();
    const [hi, localName] = await Promise.all([this.one(name, "hi-IN"), local ? this.one(name, local.sarvam) : Promise.resolve(null)]);
    this.log({ event: "translate.call", provider: "sarvam", local: local?.code ?? null, ms: Date.now() - started });
    return { hi, local: localName };
  }
}
