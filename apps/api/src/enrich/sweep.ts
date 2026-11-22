import type { ObjectStorage } from "../storage/storage.js";
import type { Store } from "../store/store.js";

/** How long an unprocessed or failed walk keeps its video for a retry. */
export const WALK_VIDEO_TTL_MS = 24 * 3600_000;

export const EXPIRED_WALK_ERROR = "This walk expired before its landmarks were found. Record it again.";

/**
 * Deletes walk videos left in storage: uploads never processed, walks that
 * failed and were never retried, and processing that never finished. The
 * walk is kept, marked failed, so the app can say what happened.
 */
export async function sweepWalkVideos(deps: {
  store: Store;
  storage: ObjectStorage;
  now: () => Date;
  log: (event: Record<string, unknown>) => void;
}): Promise<number> {
  const now = deps.now();
  const stale = await deps.store.listWalksWithVideo(new Date(now.getTime() - WALK_VIDEO_TTL_MS));
  if (stale.length === 0) return 0;
  await deps.storage.remove(stale.map((w) => w.videoPath));
  for (const walk of stale) {
    await deps.store.updateWalk({
      ...walk,
      status: walk.status === "ready" ? "ready" : "failed",
      error: walk.status === "ready" ? walk.error : EXPIRED_WALK_ERROR,
      videoDeletedAt: now,
    });
  }
  deps.log({ event: "walk.sweep", deleted: stale.length });
  return stale.length;
}

/** Frames of landmarks the recipient never reviewed are kept this long, then deleted. */
export const UNREVIEWED_FRAME_TTL_MS = 7 * 24 * 3600_000;

/**
 * Privacy: a walk's landmark crops exist only so the recipient can review them.
 * Ones never reviewed within a week are deleted, and the landmarks set aside.
 */
export async function sweepUnreviewedFrames(deps: {
  store: Store;
  storage: ObjectStorage;
  now: () => Date;
  log: (event: Record<string, unknown>) => void;
}): Promise<number> {
  const stale = await deps.store.listUnreviewedProposals(new Date(deps.now().getTime() - UNREVIEWED_FRAME_TTL_MS));
  if (stale.length === 0) return 0;
  await deps.storage.remove(stale.map((p) => p.framePath!));
  await deps.store.updateProposals(stale.map((p) => ({ ...p, status: "rejected", framePath: null })));
  deps.log({ event: "walk.frames_sweep", deleted: stale.length });
  return stale.length;
}
