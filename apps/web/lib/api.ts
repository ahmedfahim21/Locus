import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);

export type LatLon = { lat: number; lon: number };
export type Profile = { firstName: string; platforms: string[]; fallbackNote: string; phone: string };
export type Cue = { text: string; landmark: string; location: LatLon };
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
export async function api<T>(path: string, init: { method?: "GET" | "PUT"; body?: unknown } = {}): Promise<T> {
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
