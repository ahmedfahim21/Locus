import type { Candidate } from "../clues/match.js";

/**
 * Slow path (P9): asked only when the name match finds nothing.
 * Returns the id of one of the given candidates, or null if the utterance
 * doesn't identify any of them. Must never return an id outside the list.
 */
export interface PositionResolver {
  resolve(utterance: string, candidates: Candidate[]): Promise<string | null>;
}
