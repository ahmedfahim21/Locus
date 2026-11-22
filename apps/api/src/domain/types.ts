export type LatLon = { lat: number; lon: number };

/** P4: the "expecting a delivery" switch turns itself off this long after being switched on. */
export const EXPECTING_DELIVERY_MS = 3 * 3600_000;

export type Language = "hi" | "en";

export type Recipient = {
  id: string;
  firstName: string;
  /** Delivery platforms the recipient expects calls from, e.g. ["swiggy"]. */
  platforms: string[];
  /** "Expecting a delivery" switch: guidance is allowed only before this time (P4: switch-on + 3 h). */
  expectingDeliveryUntil: Date | null;
  /** Played to the rider when the handoff call isn't answered. */
  fallbackNote: string;
  /** Recipient's own phone, dialled for handoff (E.164). */
  phone: string;
};

export type Cue = {
  id: string;
  ordinal: number;
  /** Spoken instruction for this step, as the recipient typed it. */
  text: string;
  /** Landmark name the rider is likely to say when standing at this cue. */
  landmark: string;
  location: LatLon;
  /** Other names a rider might say: sign text, Hindi/Kannada names, the OSM name. */
  aliases: string[];
  source: CueSource;
  /** Storage path of the walk-video frame showing this landmark (walk-video cues only). */
  photoPath: string | null;
  /** What the landmark is (gate, tree, temple…), for the 3D view. From the walk video; null when typed. */
  kind: string | null;
  /** Its most recognisable colour as "#rrggbb" (a blue gate, a green board). From the walk video. */
  color: string | null;
};

/** typed: the recipient wrote it; walkVideo/map/streetView: kept from a suggestion. */
export type CueSource = "typed" | "walkVideo" | "map" | "streetView";

export type HomeProfile = {
  id: string;
  recipientId: string;
  handoffPoint: LatLon;
  digipin: string;
  cues: Cue[];
  confirmedAt: Date;
};

export type LocusNumber = { did: string; recipientId: string; provider: string };

export type OsmFeature = {
  osmId: string;
  name: string;
  altNames: string[];
  kind: string;
  location: LatLon;
};

export type OsmWay = {
  osmId: string;
  name: string | null;
  /** OSM highway class (primary, residential, service…); null for data imported before it was stored. */
  highway: string | null;
  nodes: { id: string; location: LatLon }[];
};

export type SessionState =
  | "screening"
  | "guiding"
  | "handoff"
  | "bridged"
  | "arrived"
  | "message"
  | "ended";

export type SessionMode = "normal" | "noTranscript";

export type Session = {
  id: string;
  clientId: string;
  recipientId: string;
  callerIdHash: string | null;
  state: SessionState;
  mode: SessionMode;
  language: Language;
  /** Index (0-based) of the last cue the rider reached; -1 before the first. */
  currentCue: number;
  lostTurns: number;
  screening: { nameHeard: boolean; platformHeard: boolean; attempts: number; objected: boolean };
  handoff: { startedAt: Date; endedAt: Date | null; answered: boolean | null } | null;
  message: string | null;
  createdAt: Date;
  endedAt: Date | null;
};

export type Turn = {
  sessionId: string;
  /** Null in no-transcript mode. */
  utterance: string | null;
  matchedCueId: string | null;
  matchedOsmId: string | null;
  instruction: string;
  lost: boolean;
  createdAt: Date;
};

export type ApiClient = {
  id: string;
  name: string;
  keyHash: string;
  /** Locus's own call worker. Only first-party clients receive the recipient's phone for handoff. */
  firstParty: boolean;
};

/** One GPS fix taken while recording a walk; `t` is ms since recording started. */
export type TrackPoint = { t: number; lat: number; lon: number; accuracyM: number };

export type WalkStatus = "awaitingUpload" | "processing" | "ready" | "failed";

/** A recipient's walk video from the main road to the door, and its GPS track. */
export type Walk = {
  id: string;
  recipientId: string;
  videoPath: string;
  contentType: string;
  durationS: number;
  track: TrackPoint[];
  status: WalkStatus;
  /** Why processing failed, in words the recipient can act on. */
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
  videoDeletedAt: Date | null;
};

export type ProposalStatus = "proposed" | "kept" | "rejected";

/** A landmark the vision model found in a walk video, waiting for the recipient to keep or skip it. */
export type WalkProposal = {
  id: string;
  walkId: string;
  recipientId: string;
  /** Order along the walk (1 = nearest the main road). */
  ordinal: number;
  name: string;
  nameHi: string | null;
  nameKn: string | null;
  aliases: string[];
  kind: string;
  /** Most recognisable colour as "#rrggbb", or null when the model saw none. */
  color: string | null;
  /** Where it sits relative to what's around it, in Hinglish as a rider would hear it ("laal building ke bagal mein"). */
  detail: string | null;
  location: LatLon;
  /** The OSM place it was snapped to, if one matched nearby. */
  osmId: string | null;
  /** Storage path of the frame; null once the frame has been deleted. */
  framePath: string | null;
  /** Seconds into the video. */
  atS: number;
  status: ProposalStatus;
};
