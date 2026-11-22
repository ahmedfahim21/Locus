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

/**
 * Persistence boundary. `PostgresStore` is the real implementation;
 * `MemoryStore` backs route tests. Both must satisfy the same contract.
 */
export interface Store {
  getClientByKeyHash(keyHash: string): Promise<ApiClient | null>;

  getNumberByDid(did: string): Promise<LocusNumber | null>;
  /** True if the E.164 number is one of Locus's own DIDs or outbound numbers. */
  isLocusNumber(e164: string): Promise<boolean>;

  getRecipient(id: string): Promise<Recipient | null>;
  getHomeProfile(recipientId: string): Promise<HomeProfile | null>;

  nearbyFeatures(center: LatLon, radiusM: number): Promise<OsmFeature[]>;
  nearbyWays(center: LatLon, radiusM: number): Promise<OsmWay[]>;

  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  updateSession(session: Session): Promise<void>;
  /** Most recent session with a handoff leg for this recipient, by handoff start. */
  latestHandoff(recipientId: string): Promise<Session["handoff"]>;

  getRecipientIdByAuthSubject(authSubject: string): Promise<string | null>;
  /** Creates the recipient on first save; afterwards updates the profile fields only. */
  saveRecipientProfile(authSubject: string, recipient: Omit<Recipient, "expectingDeliveryUntil">): Promise<void>;
  /** Replaces the recipient's home profile and its cues. */
  replaceHomeProfile(home: HomeProfile): Promise<void>;
  setExpectingDelivery(recipientId: string, until: Date | null): Promise<void>;
  getNumberForRecipient(recipientId: string): Promise<LocusNumber | null>;
  /** Most recent sessions first. */
  listRecentSessions(recipientId: string, limit: number): Promise<Session[]>;

  addTurn(turn: Turn): Promise<void>;
  /** Blanks what the rider said in every stored turn of a call (they objected to being recorded). */
  redactTurns(sessionId: string): Promise<void>;
  listTurns(sessionId: string): Promise<Turn[]>;

  createWalk(walk: Walk): Promise<void>;
  getWalk(id: string): Promise<Walk | null>;
  updateWalk(walk: Walk): Promise<void>;
  /** Replaces the walk's proposals (a re-run starts clean). */
  replaceWalkProposals(walkId: string, proposals: WalkProposal[]): Promise<void>;
  /** In walk order. */
  listWalkProposals(walkId: string): Promise<WalkProposal[]>;
  listRecipientProposals(recipientId: string): Promise<WalkProposal[]>;
  updateProposals(proposals: WalkProposal[]): Promise<void>;
  /** Walks created before `before` whose video is still in storage. */
  listWalksWithVideo(before: Date): Promise<Walk[]>;
  /** Walks still marked "processing" (after a restart, their jobs are gone). */
  listProcessingWalks(): Promise<Walk[]>;
  /** Proposals never reviewed (still "proposed", frame kept) from walks processed before `before`. */
  listUnreviewedProposals(before: Date): Promise<WalkProposal[]>;
}
