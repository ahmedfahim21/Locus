import { distinctNames } from "../clues/normalize.js";
import type { HomeProfile, OsmFeature, Recipient } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";

/** Sarvam saaras:v4 accepts up to 50 key terms per stream. */
export const MAX_KEYTERMS = 50;

/**
 * Words speech-to-text should listen for on this call, most important first:
 * the recipient's name and apps (screening), the landmarks and their Latin-script
 * aliases, then nearby mapped places, closest first. Phone audio otherwise turns
 * "Fahim" into "bahin" and "Kohenur" into "Kohinoor".
 */
export function keytermsFor(recipient: Recipient, home: HomeProfile, features: OsmFeature[]): string[] {
  const latin = (n: string) => !/[^\x00-\x7f]/.test(n);
  const landmarks = [...home.cues]
    .sort((a, b) => a.ordinal - b.ordinal)
    .flatMap((c) => [c.landmark, ...c.aliases.filter(latin)]);
  const places = [...features]
    .sort((a, b) => distanceM(home.handoffPoint, a.location) - distanceM(home.handoffPoint, b.location))
    .flatMap((f) => [f.name, ...f.altNames.filter(latin)]);
  return distinctNames([recipient.firstName, ...recipient.platforms, ...landmarks, ...places]).slice(0, MAX_KEYTERMS);
}
