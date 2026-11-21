import { heardAny, matchUtterance, type Candidate } from "../clues/match.js";
import type { Cue, HomeProfile, Language, OsmFeature, Recipient, Session, Turn } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import type { RoadGraph } from "../geo/roadGraph.js";
import { OBJECTION_PHRASES, PERSON_PHRASES, WRONG_PHRASES, say } from "./phrases.js";
import type { PositionResolver } from "./resolver.js";

export const SUPPORTED_LANGUAGES: readonly string[] = ["hi", "en"];
export const MAX_SCREENING_ATTEMPTS = 2;
export const LOST_TURNS_FOR_HANDOFF = 2;

export type RiderInput =
  | { kind: "speech"; text: string; language?: string }
  | { kind: "silence" };

export type GuideContext = {
  recipient: Recipient;
  home: HomeProfile;
  features: OsmFeature[];
  graph: RoadGraph;
  resolver: PositionResolver;
  now: Date;
};

export type TurnOutcome = { session: Session; instruction: string; turn: Turn };

const OPEN_STATES = new Set<Session["state"]>(["screening", "guiding", "message"]);

export function isOpen(session: Session): boolean {
  return OPEN_STATES.has(session.state);
}

function sortedCues(home: HomeProfile): Cue[] {
  return [...home.cues].sort((a, b) => a.ordinal - b.ordinal);
}

function startHandoff(session: Session, now: Date): Session {
  return { ...session, state: "handoff", handoff: { startedAt: now, endedAt: null, answered: null } };
}

function makeTurn(
  session: Session,
  input: RiderInput,
  instruction: string,
  now: Date,
  extra: Partial<Pick<Turn, "matchedCueId" | "matchedOsmId" | "lost">> = {},
): Turn {
  return {
    sessionId: session.id,
    utterance: session.mode === "noTranscript" || input.kind !== "speech" ? null : input.text,
    matchedCueId: extra.matchedCueId ?? null,
    matchedOsmId: extra.matchedOsmId ?? null,
    instruction,
    lost: extra.lost ?? false,
    createdAt: now,
  };
}

function screeningTurn(session: Session, input: RiderInput, ctx: GuideContext): TurnOutcome {
  const lang = session.language;
  const text = input.kind === "speech" ? input.text : "";
  const objected = session.screening.objected || heardAny(text, OBJECTION_PHRASES);
  const screening = {
    nameHeard: session.screening.nameHeard || heardAny(text, [ctx.recipient.firstName]),
    platformHeard: session.screening.platformHeard || heardAny(text, ctx.recipient.platforms),
    attempts: session.screening.attempts + 1,
    objected,
  };
  let next: Session = { ...session, screening, mode: objected ? "noTranscript" : session.mode };

  let instruction: string;
  if (screening.nameHeard && screening.platformHeard) {
    if (objected) {
      next = startHandoff(next, ctx.now);
      instruction = say.connecting(lang);
    } else {
      next = { ...next, state: "guiding" };
      instruction = say.whereAreYou(lang);
    }
  } else if (screening.attempts >= MAX_SCREENING_ATTEMPTS) {
    next = { ...next, state: "message" };
    instruction = say.takeMessage(lang);
  } else {
    instruction = say.screenAgain(lang);
  }
  return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now) };
}

function messageTurn(session: Session, input: RiderInput, ctx: GuideContext): TurnOutcome {
  const message = input.kind === "speech" ? input.text : null;
  const next: Session = { ...session, state: "ended", message, endedAt: ctx.now };
  const instruction = say.messageThanks(session.language);
  return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now) };
}

function lostTurn(session: Session, input: RiderInput, ctx: GuideContext): TurnOutcome {
  const lostTurns = session.lostTurns + 1;
  let next: Session = { ...session, lostTurns };
  let instruction: string;
  if (lostTurns >= LOST_TURNS_FOR_HANDOFF) {
    next = startHandoff(next, ctx.now);
    instruction = say.connecting(session.language);
  } else {
    instruction = say.didntUnderstand(session.language);
  }
  return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now, { lost: true }) };
}

async function guidingTurn(session: Session, input: RiderInput, ctx: GuideContext): Promise<TurnOutcome> {
  const lang: Language = session.language;
  if (input.kind === "silence") return lostTurn(session, input, ctx);
  if (input.language !== undefined && !SUPPORTED_LANGUAGES.includes(input.language)) {
    return lostTurn(session, input, ctx);
  }
  if (heardAny(input.text, PERSON_PHRASES)) {
    const next = startHandoff(session, ctx.now);
    const instruction = say.connecting(lang);
    return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now) };
  }
  if (heardAny(input.text, WRONG_PHRASES)) return lostTurn(session, input, ctx);

  const cues = sortedCues(ctx.home);
  const candidates: Candidate[] = [
    ...cues.map((c) => ({ id: c.id, kind: "cue" as const, names: [c.landmark, ...c.aliases] })),
    ...ctx.features.map((f) => ({ id: f.osmId, kind: "feature" as const, names: [f.name, ...f.altNames] })),
  ];
  const fast = matchUtterance(input.text, candidates);
  const matchedId = fast ? fast.candidate.id : await ctx.resolver.resolve(input.text, candidates);
  if (matchedId === null) return lostTurn(session, input, ctx);

  const cueIndex = cues.findIndex((c) => c.id === matchedId);
  if (cueIndex >= 0) {
    const cue = cues[cueIndex]!;
    const nextCue = cues[cueIndex + 1];
    if (!nextCue) {
      const next: Session = { ...session, state: "arrived", currentCue: cueIndex, lostTurns: 0, endedAt: ctx.now };
      const instruction = say.arrived(lang);
      return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now, { matchedCueId: cue.id }) };
    }
    const next: Session = { ...session, currentCue: cueIndex, lostTurns: 0 };
    return {
      session: next,
      instruction: nextCue.text,
      turn: makeTurn(next, input, nextCue.text, ctx.now, { matchedCueId: cue.id }),
    };
  }

  const feature = ctx.features.find((f) => f.osmId === matchedId);
  if (!feature) return lostTurn(session, input, ctx);

  // Rider is off the recorded route: one street-name step towards the nearest
  // cue they haven't reached yet (P5). Never left/right: heading is unknown.
  const remaining = cues.slice(session.currentCue + 1);
  const pool = remaining.length > 0 ? remaining : cues;
  const target = pool.reduce((best, c) =>
    distanceM(feature.location, c.location) < distanceM(feature.location, best.location) ? c : best,
  );
  const route = ctx.graph.firstStreet(feature.location, target.location);
  if (!route.reachable) return lostTurn(session, input, ctx);
  const instruction = route.street
    ? say.routeStep(lang, route.street, target.landmark)
    : say.headTowards(lang, target.landmark);
  const next: Session = { ...session, lostTurns: 0 };
  return { session: next, instruction, turn: makeTurn(next, input, instruction, ctx.now, { matchedOsmId: feature.osmId }) };
}

/** One rider turn. Caller must only pass open sessions (see `isOpen`). */
export async function handleRiderInput(
  session: Session,
  input: RiderInput,
  ctx: GuideContext,
): Promise<TurnOutcome> {
  switch (session.state) {
    case "screening":
      return screeningTurn(session, input, ctx);
    case "message":
      return messageTurn(session, input, ctx);
    case "guiding":
      return guidingTurn(session, input, ctx);
    default:
      throw new Error(`handleRiderInput called on closed session state ${session.state}`);
  }
}

/** Result of Locus's outbound handoff call. */
export function applyHandoffResult(
  session: Session,
  answered: boolean,
  recipient: Recipient,
  now: Date,
): { session: Session; instruction: string } {
  if (session.state !== "handoff" || !session.handoff) {
    throw new Error(`applyHandoffResult called in state ${session.state}`);
  }
  if (answered) {
    return {
      session: { ...session, state: "bridged", handoff: { ...session.handoff, answered: true } },
      instruction: say.connected(session.language),
    };
  }
  return {
    session: {
      ...session,
      state: "ended",
      endedAt: now,
      handoff: { ...session.handoff, answered: false, endedAt: now },
    },
    instruction: say.fallback(session.language, recipient.fallbackNote),
  };
}
