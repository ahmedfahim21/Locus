/**
 * Private object storage for walk videos and landmark frames. The web app
 * uploads videos directly with a one-time signed URL; everything else goes
 * through the API, which holds the only key.
 */
export interface ObjectStorage {
  /** A one-time upload URL for `path`. The browser uploads straight to storage with `token`. */
  createUploadUrl(path: string): Promise<{ path: string; token: string; url: string }>;
  download(path: string): Promise<Buffer>;
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** Short-lived read URLs, keyed by path. */
  signedUrls(paths: string[], expiresInS: number): Promise<Map<string, string>>;
}

export const WALK_BUCKET = "locus-walks";
/** Supabase's per-file cap on the free plan. The recorder targets well under it. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const VIDEO_TYPES = ["video/webm", "video/mp4", "video/quicktime"] as const;
