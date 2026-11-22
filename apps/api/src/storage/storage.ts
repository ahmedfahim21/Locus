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

/**
 * Reuses a signed read URL while it still has more than `minLeftS` to live, so a
 * landmark photo keeps the same URL across visits and the browser can cache it.
 * Without this, every /me signed every photo anew and phones downloaded them again.
 */
export class SignedUrlCache implements ObjectStorage {
  private readonly urls = new Map<string, { url: string; expiresAt: number }>();

  constructor(
    private readonly inner: ObjectStorage,
    private readonly now: () => number = Date.now,
    private readonly minLeftS = 15 * 60,
  ) {}

  createUploadUrl(path: string) {
    return this.inner.createUploadUrl(path);
  }
  download(path: string) {
    return this.inner.download(path);
  }
  async upload(path: string, bytes: Buffer, contentType: string) {
    this.forget([path]);
    await this.inner.upload(path, bytes, contentType);
  }
  async remove(paths: string[]) {
    this.forget(paths);
    await this.inner.remove(paths);
  }

  async signedUrls(paths: string[], expiresInS: number): Promise<Map<string, string>> {
    const now = this.now();
    const key = (p: string) => `${expiresInS}|${p}`;
    const fresh = (p: string) => {
      const hit = this.urls.get(key(p));
      return hit && hit.expiresAt - now > this.minLeftS * 1000 ? hit : null;
    };
    const missing = [...new Set(paths.filter((p) => !fresh(p)))];
    if (missing.length > 0) {
      const signed = await this.inner.signedUrls(missing, expiresInS);
      for (const [p, url] of signed) this.urls.set(key(p), { url, expiresAt: now + expiresInS * 1000 });
    }
    const out = new Map<string, string>();
    for (const p of paths) {
      const hit = this.urls.get(key(p));
      if (hit) out.set(p, hit.url);
    }
    return out;
  }

  private forget(paths: string[]) {
    for (const k of [...this.urls.keys()]) if (paths.some((p) => k.endsWith(`|${p}`))) this.urls.delete(k);
  }
}
