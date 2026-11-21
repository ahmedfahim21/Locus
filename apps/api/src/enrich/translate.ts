/** Hindi and Kannada names for a landmark the recipient typed in English, for riders and for the stamps. */
export interface NameTranslator {
  translate(name: string): Promise<{ hi: string; kn: string }>;
}

/** Sarvam's translate API (sarvam-translate:v1). */
export class SarvamTranslator implements NameTranslator {
  constructor(
    private readonly apiKey: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  private async one(input: string, target: "hi-IN" | "kn-IN"): Promise<string> {
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

  async translate(name: string) {
    const started = Date.now();
    const [hi, kn] = await Promise.all([this.one(name, "hi-IN"), this.one(name, "kn-IN")]);
    this.log({ event: "translate.call", provider: "sarvam", ms: Date.now() - started });
    return { hi, kn };
  }
}
