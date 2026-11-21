import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);

export type LatLon = { lat: number; lon: number };
export type Profile = { firstName: string; platforms: string[]; fallbackNote: string; phone: string };
export type Cue = {
  text: string;
  landmark: string;
  location: LatLon;
  /** Other names a rider might say, including Hindi and Kannada script. */
  aliases: string[];
  source: "typed" | "walkVideo" | "map" | "streetView";
  /** Short-lived signed URL of the walk-video frame, for walk-video landmarks. */
  photoUrl: string | null;
  /** From the walk video, for the 3D view: what it is and its colour ("#rrggbb"). */
  kind: string | null;
  color: string | null;
  /** The walk proposal this landmark came from; send it back to keep the photo. */
  proposalId: string | null;
};

/** What PUT /me/home takes for each landmark. */
export type CueInput = {
  text: string;
  landmark: string;
  location: LatLon;
  aliases?: string[];
  proposalId?: string;
  source?: "map" | "streetView";
  kind?: string;
  color?: string;
};

export type SuggestionSource = "map" | "video" | "street";
export type Suggestion = {
  id: string;
  name: string;
  nameHi: string | null;
  nameKn: string | null;
  aliases: string[];
  kind: string | null;
  color: string | null;
  location: LatLon;
  alongM: number;
  sources: SuggestionSource[];
  osmId: string | null;
  proposalId: string | null;
  photoUrl: string | null;
  text: string;
  recommended: boolean;
};
export type RoutePlan = {
  entryStreet: string | null;
  line: LatLon[];
  lengthM: number;
  turns: { atM: number; location: LatLon; direction: "left" | "right"; onto: string | null }[];
};
export type Suggestions = {
  route: RoutePlan;
  suggestions: Suggestion[];
  streetView: { status: "ok" | "off" | "error"; message?: string; found?: number };
};

export type WalkStatus = "awaitingUpload" | "processing" | "ready" | "failed";
export type Walk = { id: string; status: WalkStatus; error: string | null; createdAt: string; processedAt: string | null };
export type Proposal = {
  id: string;
  ordinal: number;
  name: string;
  nameHi: string | null;
  nameKn: string | null;
  aliases: string[];
  kind: string;
  color: string | null;
  location: LatLon;
  osmId: string | null;
  atS: number;
  status: "proposed" | "kept" | "rejected";
  photoUrl: string | null;
};
export type TrackPoint = { t: number; lat: number; lon: number; accuracyM: number };

/** Hindi (Devanagari) and Kannada names among a landmark's aliases, for the stamps. */
export function scriptNames(aliases: string[]): { text: string; script: "deva" | "knda" }[] {
  const out: { text: string; script: "deva" | "knda" }[] = [];
  const deva = aliases.find((a) => /[\u0900-\u097F]/.test(a));
  const knda = aliases.find((a) => /[\u0C80-\u0CFF]/.test(a));
  if (deva) out.push({ text: deva, script: "deva" });
  if (knda) out.push({ text: knda, script: "knda" });
  return out;
}
export type Home = { handoffPoint: LatLon; digipin: string; confirmedAt: string; cues: Cue[] };
export type Me = {
  identity: { email: string | null; name: string | null };
  recipient: (Profile & { expectingDeliveryUntil: string | null }) | null;
  home: Home | null;
  number: string | null;
};
export type Call = {
  id: string;
  state: string;
  noTranscript: boolean;
  createdAt: string;
  endedAt: string | null;
  message: string | null;
  /** Ordinal of the last landmark the rider reached; 0 before the first. */
  reachedCue: number;
  handoff:{ startedAt: string; endedAt: string | null; answered: boolean | null } | null;
  turns: { utterance: string | null; instruction: string; lost: boolean; createdAt: string }[];
};

/** One stretch of the rider's route. `onRoads: false` is a straight line where OSM has no road connection. */
export type RouteLeg = { onRoads: boolean; line: LatLon[] };
export type Route = { legs: RouteLeg[] };

/** Call states the worker can still change. */
export const LIVE_STATES = new Set(["screening", "guiding", "handoff", "bridged", "message"]);

export const STATE_LABEL: Record<string, string> = {
  screening: "Checking who's calling",
  guiding: "Guiding the rider",
  handoff: "Calling you",
  bridged: "Connected to you",
  arrived: "Rider arrived",
  message: "Taking a message",
  ended: "Ended",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Locus API as the signed-in recipient. Errors are thrown, never swallowed. */
export async function api<T>(path: string, init: { method?: "GET" | "PUT" | "POST"; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Sign in again");
  const res = await fetch(`${process.env.NEXT_PUBLIC_LOCUS_API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "UNKNOWN", json.error?.message ?? `Request failed (${res.status})`);
  return json;
}
