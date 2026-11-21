import type { Session } from "../domain/types.js";

/** P3 (D40, D49): keep rejecting a recipient's DID this long after a handoff leg ends. */
export const HANDOFF_GRACE_MS = 60_000;

/**
 * True if an inbound call on this recipient's DID must be rejected because it
 * may be Locus's own handoff call forwarded back by the carrier.
 */
export function inHandoffWindow(handoff: Session["handoff"], now: Date): boolean {
  if (!handoff) return false;
  if (handoff.endedAt === null) return true;
  return now.getTime() - handoff.endedAt.getTime() < HANDOFF_GRACE_MS;
}
