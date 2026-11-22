import type {
  ApiClient,
  HomeProfile,
  LatLon,
  OsmFeature,
  OsmWay,
  LocusNumber,
  Recipient,
  Session,
  Turn,
  Walk,
  WalkProposal,
} from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import type { Store } from "./store.js";

/** In-memory store for route tests. Mirrors PostgresStore's contract. */
export class MemoryStore implements Store {
  clients: ApiClient[] = [];
  numbers: LocusNumber[] = [];
  /** Locus outbound numbers, in addition to every DID in `numbers`. */
  outboundNumbers: string[] = [];
  recipients: Recipient[] = [];
  homes: HomeProfile[] = [];
  features: OsmFeature[] = [];
  ways: OsmWay[] = [];
  /** authSubject → recipientId */
  authSubjects = new Map<string, string>();
  sessions = new Map<string, Session>();
  turns: Turn[] = [];
  walks: Walk[] = [];
  proposals: WalkProposal[] = [];

  async ensureClient(client: ApiClient) {
    if (!this.clients.some((c) => c.id === client.id)) this.clients.push(client);
  }
  async getClientByKeyHash(keyHash: string) {
    return this.clients.find((c) => c.keyHash === keyHash) ?? null;
  }
  async getNumberByDid(did: string) {
    return this.numbers.find((n) => n.did === did) ?? null;
  }
  async isLocusNumber(e164: string) {
    return this.outboundNumbers.includes(e164) || this.numbers.some((n) => n.did === e164);
  }
  async getRecipient(id: string) {
    return structuredClone(this.recipients.find((r) => r.id === id) ?? null);
  }
  async getHomeProfile(recipientId: string) {
    return structuredClone(this.homes.find((h) => h.recipientId === recipientId) ?? null);
  }
  async nearbyFeatures(center: LatLon, radiusM: number) {
    return this.features.filter((f) => distanceM(center, f.location) <= radiusM);
  }
  async nearbyWays(center: LatLon, radiusM: number) {
    return this.ways.filter((w) => w.nodes.some((n) => distanceM(center, n.location) <= radiusM));
  }
  async createSession(session: Session) {
    this.sessions.set(session.id, structuredClone(session));
  }
  async getSession(id: string) {
    return structuredClone(this.sessions.get(id) ?? null);
  }
  async updateSession(session: Session) {
    if (!this.sessions.has(session.id)) throw new Error(`session ${session.id} not found`);
    this.sessions.set(session.id, structuredClone(session));
  }
  async latestHandoff(recipientId: string) {
    const legs = [...this.sessions.values()]
      .filter((s) => s.recipientId === recipientId && s.handoff)
      .map((s) => s.handoff!)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return structuredClone(legs[0] ?? null);
  }
  async getRecipientIdByAuthSubject(authSubject: string) {
    return this.authSubjects.get(authSubject) ?? null;
  }
  async saveRecipientProfile(authSubject: string, recipient: Omit<Recipient, "expectingDeliveryUntil">) {
    const existing = this.recipients.find((r) => r.id === recipient.id);
    if (existing) Object.assign(existing, structuredClone(recipient));
    else this.recipients.push({ ...structuredClone(recipient), expectingDeliveryUntil: null });
    this.authSubjects.set(authSubject, recipient.id);
  }
  async replaceHomeProfile(home: HomeProfile) {
    this.homes = this.homes.filter((h) => h.recipientId !== home.recipientId);
    this.homes.push(structuredClone(home));
  }
  async setExpectingDelivery(recipientId: string, until: Date | null) {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (!r) throw new Error(`recipient ${recipientId} not found`);
    r.expectingDeliveryUntil = until;
  }
  async getNumberForRecipient(recipientId: string) {
    return structuredClone(this.numbers.find((n) => n.recipientId === recipientId) ?? null);
  }
  async listRecentSessions(recipientId: string, limit: number) {
    return structuredClone(
      [...this.sessions.values()]
        .filter((s) => s.recipientId === recipientId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit),
    );
  }
  async addTurn(turn: Turn) {
    this.turns.push(structuredClone(turn));
  }
  async listTurns(sessionId: string) {
    return structuredClone(this.turns.filter((t) => t.sessionId === sessionId));
  }
  async createWalk(walk: Walk) {
    this.walks.push(structuredClone(walk));
  }
  async getWalk(id: string) {
    return structuredClone(this.walks.find((w) => w.id === id) ?? null);
  }
  async updateWalk(walk: Walk) {
    const i = this.walks.findIndex((w) => w.id === walk.id);
    if (i < 0) throw new Error(`walk ${walk.id} not found`);
    this.walks[i] = structuredClone(walk);
  }
  async replaceWalkProposals(walkId: string, proposals: WalkProposal[]) {
    this.proposals = [...this.proposals.filter((p) => p.walkId !== walkId), ...structuredClone(proposals)];
  }
  async listWalkProposals(walkId: string) {
    return structuredClone(this.proposals.filter((p) => p.walkId === walkId).sort((a, b) => a.ordinal - b.ordinal));
  }
  async listRecipientProposals(recipientId: string) {
    return structuredClone(this.proposals.filter((p) => p.recipientId === recipientId));
  }
  async listWalksWithVideo(before: Date) {
    return structuredClone(this.walks.filter((w) => w.videoDeletedAt === null && w.createdAt < before));
  }
  async listProcessingWalks() {
    return structuredClone(this.walks.filter((w) => w.status === "processing"));
  }
  async redactTurns(sessionId: string) {
    for (const t of this.turns) if (t.sessionId === sessionId) t.utterance = null;
  }
  async listUnreviewedProposals(before: Date) {
    const old = new Set(this.walks.filter((w) => w.processedAt !== null && w.processedAt < before).map((w) => w.id));
    return structuredClone(this.proposals.filter((p) => p.status === "proposed" && p.framePath !== null && old.has(p.walkId)));
  }
  async updateProposals(proposals: WalkProposal[]) {
    for (const p of proposals) {
      const i = this.proposals.findIndex((x) => x.id === p.id);
      if (i < 0) throw new Error(`proposal ${p.id} not found`);
      this.proposals[i] = structuredClone(p);
    }
  }
}
