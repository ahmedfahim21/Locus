import { matchUtterance } from "../clues/match.js";
import { distinctNames, nameKey } from "../clues/normalize.js";
import type { LatLon, OsmFeature, Walk, WalkProposal } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import { inScript, DEVANAGARI, KANNADA, type WalkDeps } from "./processWalk.js";
import { MAX_PROPOSALS, type VisionLandmark } from "./vision.js";

/** Photos go to the vision model in one request; more than this adds little for one route. */
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
/** Photos carry no GPS track, so a landmark is placed by its name among mapped places this close to the gate. */
export const PLACE_BY_NAME_M = 700;

/** The mapped place a landmark names, nearest the gate when several match. */
export function placeByName(landmark: { name: string; aliases: string[] }, door: LatLon, features: OsmFeature[]): OsmFeature | null {
  const nearby = features.filter((f) => distanceM(door, f.location) <= PLACE_BY_NAME_M);
  const heard = [landmark.name, ...landmark.aliases].join(" ");
  const matches = nearby.filter((f) => {
    const m = matchUtterance(heard, [{ id: f.osmId, kind: "feature" as const, names: [f.name, ...f.altNames] }]);
    return m !== null && m.coverage >= 0.5;
  });
  return matches.sort((a, b) => distanceM(door, a.location) - distanceM(door, b.location))[0] ?? null;
}

/**
 * Photos → landmark proposals, the same shape a walk video produces, so review,
 * keep/skip, photos on pins and cleanup all work unchanged. A landmark the map
 * doesn't know starts at the gate; the recipient drags it into place.
 * Never throws: failures are recorded on the walk.
 */
export async function processPhotos(deps: Omit<WalkDeps, "frames"> & { frames: Pick<WalkDeps["frames"], "crop"> }, walkId: string, photos: Buffer[], door: LatLon): Promise<void> {
  const walk = await deps.store.getWalk(walkId);
  if (!walk) throw new Error(`walk ${walkId} not found`);
  const uploaded: string[] = [];
  try {
    const found = await deps.vision.find(photos.map((jpeg, index) => ({ index, jpeg, distanceM: 0, label: `Photo ${index}` })));
    const valid = found.filter((l) => Number.isInteger(l.frame) && l.frame >= 0 && l.frame < photos.length && l.name.trim());
    if (valid.length !== found.length) deps.log({ event: "photos.vision_dropped", walkId, dropped: found.length - valid.length });

    const byName = new Map<string, VisionLandmark>();
    for (const l of valid) if (!byName.has(nameKey(l.name))) byName.set(nameKey(l.name), l);
    const chosen = [...byName.values()].slice(0, MAX_PROPOSALS);

    const features = await deps.store.nearbyFeatures(door, PLACE_BY_NAME_M);
    const proposals: WalkProposal[] = [];
    for (const [i, l] of chosen.entries()) {
      const osm = placeByName(l, door, features);
      const framePath = `frames/${walk.recipientId}/${walk.id}/${i + 1}.jpg`;
      // Only the landmark's part of the photo is kept.
      await deps.storage.upload(framePath, await deps.frames.crop(photos[l.frame]!, l.box), "image/jpeg");
      uploaded.push(framePath);
      proposals.push({
        id: `prp_${deps.newId()}`,
        walkId: walk.id,
        recipientId: walk.recipientId,
        ordinal: i + 1,
        name: l.name.trim(),
        nameHi: inScript(l.nameHi, DEVANAGARI),
        nameKn: inScript(l.nameKn, KANNADA),
        aliases: distinctNames([...l.aliases, ...(osm ? [osm.name, ...osm.altNames] : [])], l.name),
        kind: l.kind,
        color: /^#[0-9a-f]{6}$/i.test(l.color.trim()) ? l.color.trim().toLowerCase() : null,
        detail: l.detail.trim() || null,
        location: osm?.location ?? door,
        osmId: osm?.osmId ?? null,
        framePath,
        atS: l.frame,
        status: "proposed",
      });
    }
    await deps.store.replaceWalkProposals(walk.id, proposals);
    const done: Walk = { ...walk, status: "ready", error: null, processedAt: deps.now() };
    await deps.store.updateWalk(done);
    deps.log({ event: "photos.ready", walkId, photos: photos.length, proposals: proposals.length, placed: proposals.filter((p) => p.osmId).length });
  } catch (err) {
    deps.log({ event: "photos.failed", walkId, message: (err as Error).message, stack: (err as Error).stack });
    if (uploaded.length > 0) {
      await deps.storage.remove(uploaded).catch((cleanupErr: Error) =>
        deps.log({ event: "photos.cleanup_failed", walkId, message: cleanupErr.message }),
      );
    }
    await deps.store.updateWalk({ ...walk, status: "failed", error: `Couldn't read the photos: ${(err as Error).message}. Add them again.`, processedAt: deps.now() });
  }
}
