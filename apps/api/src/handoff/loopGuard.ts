import type { Session } from "../domain/types.js";

/** P3 (D40, D49): keep rejecting a recipient's DID this long after a handoff leg ends. */
export const HANDOFF_GRACE_MS = 60_000;
/**
 * A handoff never recorded as ended (the worker crashed, or a bridged call's end
 * was lost) counts as ended this long after it started, so it can't lock the
 * recipient out of every later delivery call. Longer than any real bridged call.
 */
export const MAX_OPEN_HANDOFF_MS = 20 * 60_000;

/**
 * True if an inbound call on this recipient's DID must be rejected because it
 * may be Locus's own handoff call forwarded back by the carrier.
 */
export function inHandoffWindow(handoff: Session["handoff"], now: Date): boolean {
  if (!handoff) return false;
  const endedAt = handoff.endedAt?.getTime() ?? handoff.startedAt.getTime() + MAX_OPEN_HANDOFF_MS;
  return now.getTime() < endedAt + HANDOFF_GRACE_MS;
}
