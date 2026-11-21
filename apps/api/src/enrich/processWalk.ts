import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchUtterance } from "../clues/match.js";
import { distinctNames, nameKey } from "../clues/normalize.js";
import type { LatLon, OsmFeature, Walk, WalkProposal } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import type { ObjectStorage } from "../storage/storage.js";
import type { Store } from "../store/store.js";
import { sampleAlongTrack, WalkError } from "./track.js";
import { MAX_PROPOSALS, type LandmarkVision, type VisionLandmark } from "./vision.js";

/** An OSM place this close to the GPS position with a matching name is the same place. */
export const SNAP_RADIUS_M = 40;

export type WalkDeps = {
  store: Store;
  storage: ObjectStorage;
  vision: LandmarkVision;
  frames: {
    probeDurationS(file: string): Promise<number>;
    extractFrames(file: string, timesS: number[]): Promise<Buffer[]>;
  };
  now: () => Date;
  newId: () => string;
  log: (event: Record<string, unknown>) => void;
};

/** The OSM place a proposal names, if one is nearby. */
export function snapToOsm(landmark: { name: string; aliases: string[] }, at: LatLon, features: OsmFeature[]): OsmFeature | null {
  const nearby = features.filter((f) => distanceM(at, f.location) <= SNAP_RADIUS_M);
  if (nearby.length === 0) return null;
  const heard = [landmark.name, ...landmark.aliases].join(" ");
  const match = matchUtterance(
    heard,
    nearby.map((f) => ({ id: f.osmId, kind: "feature" as const, names: [f.name, ...f.altNames] })),
  );
  return match && match.coverage >= 0.5 ? nearby.find((f) => f.osmId === match.candidate.id)! : null;
}

/**
 * Walk video → landmark proposals: sample frames every ~10 m along the GPS
 * track, ask the vision model what a rider could see, snap names to OSM places,
 * keep one frame per landmark, then delete the video (section 4.6).
 * Never throws: failures are recorded on the walk for the recipient to see.
 */
export async function processWalk(deps: WalkDeps, walkId: string): Promise<void> {
  const walk = await deps.store.getWalk(walkId);
  if (!walk) throw new Error(`walk ${walkId} not found`);
  const dir = await mkdtemp(join(tmpdir(), "locus-walk-"));
  const uploaded: string[] = [];
  try {
    const video = join(dir, "video");
    await writeFile(video, await deps.storage.download(walk.videoPath));
    const durationS = await deps.frames.probeDurationS(video);
    const samples = sampleAlongTrack(walk.track, Math.min(durationS, walk.durationS));
    const jpegs = await deps.frames.extractFrames(video, samples.map((s) => s.atS));

    const found = await deps.vision.find(jpegs.map((jpeg, index) => ({ index, jpeg, distanceM: samples[index]!.distanceM })));
    const valid = found.filter((l) => Number.isInteger(l.frame) && l.frame >= 0 && l.frame < samples.length && l.name.trim());
    if (valid.length !== found.length) {
      deps.log({ event: "walk.vision_dropped", walkId, dropped: found.length - valid.length });
    }

    // One proposal per name, in walk order.
    const byName = new Map<string, VisionLandmark>();
    for (const l of valid.sort((a, b) => a.frame - b.frame)) {
      const key = nameKey(l.name);
      if (!byName.has(key)) byName.set(key, l);
    }
    const chosen = [...byName.values()].slice(0, MAX_PROPOSALS);

    const features = await deps.store.nearbyFeatures(samples[Math.floor(samples.length / 2)]!.location, 600);
    const proposals: WalkProposal[] = [];
    for (const [i, l] of chosen.entries()) {
      const sample = samples[l.frame]!;
      const osm = snapToOsm(l, sample.location, features);
      const framePath = `frames/${walk.recipientId}/${walk.id}/${i + 1}.jpg`;
      await deps.storage.upload(framePath, jpegs[l.frame]!, "image/jpeg");
      uploaded.push(framePath);
      proposals.push({
        id: `prp_${deps.newId()}`,
        walkId: walk.id,
        recipientId: walk.recipientId,
        ordinal: i + 1,
        name: l.name.trim(),
        nameHi: l.nameHi.trim() || null,
        nameKn: l.nameKn.trim() || null,
        aliases: distinctNames([...l.aliases, ...(osm ? [osm.name, ...osm.altNames] : [])], l.name),
        kind: l.kind,
        location: osm?.location ?? sample.location,
        osmId: osm?.osmId ?? null,
        framePath,
        atS: sample.atS,
        status: "proposed",
      });
    }

    await deps.store.replaceWalkProposals(walk.id, proposals);
    await deps.storage.remove([walk.videoPath]);
    const done: Walk = { ...walk, status: "ready", error: null, processedAt: deps.now(), videoDeletedAt: deps.now() };
    await deps.store.updateWalk(done);
    deps.log({ event: "walk.ready", walkId, frames: samples.length, proposals: proposals.length, snapped: proposals.filter((p) => p.osmId).length });
  } catch (err) {
    const known = err instanceof WalkError;
    deps.log({ event: "walk.failed", walkId, message: (err as Error).message, stack: known ? undefined : (err as Error).stack });
    if (uploaded.length > 0) {
      await deps.storage.remove(uploaded).catch((cleanupErr: Error) =>
        deps.log({ event: "walk.cleanup_failed", walkId, message: cleanupErr.message }),
      );
    }
    await deps.store.updateWalk({
      ...walk,
      status: "failed",
      error: known ? (err as Error).message : `Processing failed: ${(err as Error).message}`,
      processedAt: deps.now(),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
