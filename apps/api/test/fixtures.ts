import type { LocalLanguage } from "../src/geo/region.js";
import { createApp, sha256 } from "../src/app.js";
import type { Candidate } from "../src/clues/match.js";
import type { HomeProfile, Recipient } from "../src/domain/types.js";
import type { PositionResolver } from "../src/guide/resolver.js";
import { extractFrames, probeDurationS, type Box } from "../src/enrich/frames.js";
import type { LandmarkVision, VisionFrame, VisionLandmark } from "../src/enrich/vision.js";
import type { NameTranslator } from "../src/enrich/translate.js";
import type { PhoneCaller, TestCallIssuer } from "../src/voice/testCall.js";
import type { StreetImagery } from "../src/onboarding/streetView.js";
import type { ObjectStorage } from "../src/storage/storage.js";
import { MemoryStore } from "../src/store/memory.js";

export const API_KEY = "test-key-locus-worker";
export const OTHER_KEY = "test-key-other-client";
export const DID = "+918000000001";
export const LOCUS_OUTBOUND = "+918000000099";
export const T0 = new Date("2026-11-22T10:00:00.000Z");
export const WEB_ORIGIN = "http://localhost:3000";

export const recipient: Recipient = {
  id: "rcp_seed",
  firstName: "Ahmed",
  platforms: ["swiggy"],
  expectingDeliveryUntil: new Date(T0.getTime() + 3 * 3600_000),
  fallbackNote: "security guard ko de dijiye",
  phone: "+919800000000",
};

export const home: HomeProfile = {
  id: "home_1",
  recipientId: "rcp_seed",
  handoffPoint: { lat: 13.0357, lon: 77.5969 },
  digipin: "4P3JK852C9",
  confirmedAt: T0,
  cues: [
    {
      id: "cue_1",
      ordinal: 1,
      landmark: "Shell petrol pump",
      text: "Petrol pump ke baad Bellary Road se left lijiye.",
      location: { lat: 13.035, lon: 77.596 },
      aliases: [],
      source: "typed",
      photoPath: null,
      kind: null,
      color: null,
    },
    {
      id: "cue_2",
      ordinal: 2,
      landmark: "Hanuman temple",
      text: "Hanuman mandir aapke right mein aayega, uske peeche wali gali mein aaiye.",
      location: { lat: 13.0354, lon: 77.5966 },
      aliases: [],
      source: "typed",
      photoPath: null,
      kind: null,
      color: null,
    },
    {
      id: "cue_3",
      ordinal: 3,
      landmark: "blue gate",
      text: "Neela gate, nariyal ke ped wala ghar. Wahi rukiye.",
      location: { lat: 13.0357, lon: 77.5969 },
      aliases: [],
      source: "typed",
      photoPath: null,
      kind: null,
      color: null,
    },
  ],
};

export class FakeResolver implements PositionResolver {
  calls: { utterance: string; candidateIds: string[] }[] = [];
  answer: string | null = null;
  async resolve(utterance: string, candidates: Candidate[]) {
    this.calls.push({ utterance, candidateIds: candidates.map((c) => c.id) });
    return this.answer;
  }
}

/** In-memory object storage; `uploadTokens` records the one-time upload URLs handed out. */
export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, { bytes: Buffer; contentType: string }>();
  uploadTokens = new Map<string, string>();
  async createUploadUrl(path: string) {
    const token = `upl_${this.uploadTokens.size + 1}`;
    this.uploadTokens.set(token, path);
    return { path, token, url: `memory://upload/${path}?token=${token}` };
  }
  /** What the browser does with the signed URL. */
  browserUpload(token: string, bytes: Buffer, contentType: string) {
    const path = this.uploadTokens.get(token);
    if (!path) throw new Error(`unknown upload token ${token}`);
    this.objects.set(path, { bytes, contentType });
  }
  async download(path: string) {
    const o = this.objects.get(path);
    if (!o) throw new Error(`Object not found: ${path}`);
    return o.bytes;
  }
  async upload(path: string, bytes: Buffer, contentType: string) {
    this.objects.set(path, { bytes, contentType });
  }
  async remove(paths: string[]) {
    for (const p of paths) this.objects.delete(p);
  }
  async signedUrls(paths: string[], expiresInS: number) {
    return new Map(paths.map((p) => [p, `https://storage.test/${p}?exp=${expiresInS}`]));
  }
}

/** Returns canned landmarks and records the frames it was shown. */
export class FakeVision implements LandmarkVision {
  seen: VisionFrame[][] = [];
  /** The local language each call asked for ("te", "kn", or null). */
  languages: (string | null)[] = [];
  answer: VisionLandmark[] = [];
  error: Error | null = null;
  async find(frames: VisionFrame[], local: LocalLanguage | null) {
    this.seen.push(frames);
    this.languages.push(local?.code ?? null);
    if (this.error) throw this.error;
    return structuredClone(this.answer);
  }
}

/** Deterministic "translations" that are easy to assert; `failFor` simulates a Sarvam outage for one name. */
export class FakeTranslator implements NameTranslator {
  calls: string[] = [];
  /** The local language each call asked for. */
  languages: (string | null)[] = [];
  failFor: string | null = null;
  async translate(name: string, local: LocalLanguage | null) {
    this.calls.push(name);
    this.languages.push(local?.code ?? null);
    if (name === this.failFor) throw new Error("Sarvam translate returned 503: busy");
    const sample = { te: "తెలు", kn: "ಕನ್ನ" } as const;
    return { hi: `${name} हिं`, local: local ? `${name} ${sample[local.code]}` : null };
  }
}

/** Records which recipients asked for a browser test call. */
export class FakeTestCalls implements TestCallIssuer {
  issued: string[] = [];
  async issue(recipientId: string) {
    this.issued.push(recipientId);
    return { url: "ws://livekit.test", token: `token-for-${recipientId}`, room: `test-${this.issued.length}` };
  }
}

export class FakePhoneCalls implements PhoneCaller {
  rung: { recipientId: string; phone: string }[] = [];
  async ring(recipientId: string, phone: string) {
    this.rung.push({ recipientId, phone });
    return { room: `rider-${this.rung.length}` };
  }
}

export function setup(options: { testCalls?: boolean; phoneCalls?: boolean; streetImagery?: StreetImagery } = {}) {
  const store = new MemoryStore();
  store.clients = [
    { id: "client_worker", name: "locus-worker", keyHash: sha256(API_KEY), firstParty: true },
    { id: "client_other", name: "other", keyHash: sha256(OTHER_KEY), firstParty: false },
  ];
  store.numbers = [{ did: DID, recipientId: recipient.id, provider: "plivo" }];
  store.outboundNumbers = [LOCUS_OUTBOUND];
  store.recipients = [structuredClone(recipient)];
  store.homes = [structuredClone(home)];
  store.features = [
    {
      osmId: "node/101",
      name: "Sri Anjaneya Temple",
      altNames: ["Hanuman Mandir"],
      kind: "place_of_worship",
      location: { lat: 13.0354, lon: 77.5966 },
    },
    { osmId: "node/102", name: "Iyengar Bakery", altNames: [], kind: "bakery", location: { lat: 13.0345, lon: 77.5975 } },
    { osmId: "node/999", name: "Far Away Mall", altNames: [], kind: "mall", location: { lat: 13.1, lon: 77.7 } },
  ];
  store.ways = [
    {
      osmId: "way/1",
      name: "Bellary Road",
      highway: "primary",
      nodes: [
        { id: "n1", location: { lat: 13.0345, lon: 77.5975 } },
        { id: "n2", location: { lat: 13.035, lon: 77.596 } },
      ],
    },
    {
      osmId: "way/2",
      name: "2nd Cross Road",
      highway: "residential",
      nodes: [
        { id: "n2", location: { lat: 13.035, lon: 77.596 } },
        { id: "n3", location: { lat: 13.0354, lon: 77.5966 } },
        { id: "n4", location: { lat: 13.0357, lon: 77.5969 } },
      ],
    },
  ];
  const resolver = new FakeResolver();
  const storage = new MemoryStorage();
  const vision = new FakeVision();
  const translator = new FakeTranslator();
  const testCalls = new FakeTestCalls();
  const phoneCalls = new FakePhoneCalls();
  const pending: Promise<void>[] = [];
  const clock = { now: new Date(T0) };
  const logs: Record<string, unknown>[] = [];
  const crops: Box[] = [];
  let seq = 0;
  const app = createApp({
    store,
    resolver,
    now: () => new Date(clock.now),
    newId: () => String(++seq),
    log: (e) => logs.push(e),
    // Test tokens are "tok:<sub>"; anything else is rejected.
    verifyRecipient: async (token) =>
      token.startsWith("tok:") ? { sub: token.slice(4), email: `${token.slice(4)}@example.com`, name: "Test User" } : null,
    webOrigin: WEB_ORIGIN,
    storage,
    vision,
    translator,
    testCalls: options.testCalls === false ? null : testCalls,
    phoneCalls: options.phoneCalls === false ? null : phoneCalls,
    streetImagery: options.streetImagery ?? null,
    // Crops are recorded and passed through, so tests can check what box each stored image came from.
    frames: {
      probeDurationS,
      extractFrames,
      crop: async (jpeg: Buffer, box: Box) => {
        crops.push(box);
        return jpeg;
      },
    },
    background: (task) => {
      pending.push(task());
    },
  });
  /** Waits for background work (walk processing) started by requests so far. */
  const settle = async () => {
    while (pending.length) await pending.shift();
  };

  async function call(method: string, path: string, body?: unknown, key: string | null = API_KEY) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  const startSession = (extra: Record<string, unknown> = {}) =>
    call("POST", "/v1/sessions", { did: DID, callerId: "+919111111111", ...extra });
  const say = (id: string, text: string, language?: string) =>
    call("POST", `/v1/sessions/${id}/utterances`, language ? { kind: "speech", text, language } : { kind: "speech", text });

  return { store, resolver, storage, vision, translator, testCalls, phoneCalls, clock, logs, crops, app, call, startSession, say, settle };
}
