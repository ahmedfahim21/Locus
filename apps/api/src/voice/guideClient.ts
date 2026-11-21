/** HTTP client for the guide-session API, used by Locus's own call worker. */

export type GuideReply = {
  instruction: string;
  state: string;
  lostTurns?: number;
  handoffPhone?: string;
};

export type CreateResult =
  | { ok: true; sessionId: string; instruction: string; keyterms: string[] }
  | { ok: false; code: string; message: string };

export class GuideApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

export class GuideClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  private static unwrap(res: { status: number; json: Record<string, unknown> }): Record<string, unknown> {
    if (res.status >= 200 && res.status < 300) return res.json;
    const err = res.json.error as { code?: string; message?: string } | undefined;
    throw new GuideApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Unexpected response");
  }

  /** Expected refusals (unknown number, switch off, loop guard) come back as `ok: false`, not thrown. */
  /** A phone call names the dialled number; a browser test call names the recipient. */
  async createSession(
    target: { did: string } | { recipientId: string },
    callerId: string | undefined,
    language: "hi" | "en",
  ): Promise<CreateResult> {
    const res = await this.post("/v1/sessions", { ...target, ...(callerId ? { callerId } : {}), language });
    if (res.status === 201) {
      return {
        ok: true,
        sessionId: String(res.json.sessionId),
        instruction: String(res.json.instruction),
        keyterms: Array.isArray(res.json.keyterms) ? (res.json.keyterms as string[]) : [],
      };
    }
    const err = res.json.error as { code?: string; message?: string } | undefined;
    if ((res.status === 404 || res.status === 409) && err?.code) {
      return { ok: false, code: err.code, message: err.message ?? "" };
    }
    throw new GuideApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Unexpected response");
  }

  async utterance(sessionId: string, text: string, language?: string): Promise<GuideReply> {
    const body = { kind: "speech", text, ...(language ? { language } : {}) };
    return GuideClient.unwrap(await this.post(`/v1/sessions/${sessionId}/utterances`, body)) as GuideReply;
  }

  async silence(sessionId: string): Promise<GuideReply> {
    return GuideClient.unwrap(await this.post(`/v1/sessions/${sessionId}/utterances`, { kind: "silence" })) as GuideReply;
  }

  async handoffResult(sessionId: string, answered: boolean): Promise<GuideReply> {
    return GuideClient.unwrap(await this.post(`/v1/sessions/${sessionId}/handoff-result`, { answered })) as GuideReply;
  }

  async end(sessionId: string): Promise<void> {
    GuideClient.unwrap(await this.post(`/v1/sessions/${sessionId}/end`, {}));
  }
}
