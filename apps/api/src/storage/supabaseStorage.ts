import { MAX_UPLOAD_BYTES, VIDEO_TYPES, type ObjectStorage } from "./storage.js";

/** Supabase Storage over its REST API, authenticated with the project's secret key (server only). */
export class SupabaseStorage implements ObjectStorage {
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly secretKey: string,
    private readonly bucket: string,
  ) {
    this.base = `${supabaseUrl.replace(/\/$/, "")}/storage/v1`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.secretKey, authorization: `Bearer ${this.secretKey}`, ...extra };
  }

  private async request(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${this.base}${path}`, { method, body: init.body, headers: this.headers(init.headers) });
    if (!res.ok) throw new Error(`Supabase Storage ${method} ${path.split("?")[0]} returned ${res.status}: ${await res.text()}`);
    return res;
  }

  private objectPath(path: string) {
    return `${this.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Creates the private bucket if it doesn't exist yet. Safe to call on every start. */
  async ensureBucket() {
    const res = await fetch(`${this.base}/bucket/${this.bucket}`, { headers: this.headers() });
    if (res.ok) return;
    if (res.status !== 400 && res.status !== 404) {
      throw new Error(`Supabase Storage bucket check returned ${res.status}: ${await res.text()}`);
    }
    await this.request("POST", "/bucket", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
        file_size_limit: MAX_UPLOAD_BYTES,
        allowed_mime_types: [...VIDEO_TYPES, "image/jpeg"],
      }),
    });
  }

  async createUploadUrl(path: string) {
    const res = await this.request("POST", `/object/upload/sign/${this.objectPath(path)}`);
    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error("Supabase Storage returned no upload URL");
    const token = new URL(body.url, "http://x").searchParams.get("token");
    if (!token) throw new Error("Supabase Storage upload URL has no token");
    return { path, token, url: `${this.base}${body.url}` };
  }

  async download(path: string) {
    const res = await this.request("GET", `/object/${this.objectPath(path)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(path: string, bytes: Buffer, contentType: string) {
    await this.request("POST", `/object/${this.objectPath(path)}`, {
      headers: { "content-type": contentType, "x-upsert": "true" },
      body: new Uint8Array(bytes),
    });
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    await this.request("DELETE", `/object/${this.bucket}`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }

  async signedUrls(paths: string[], expiresInS: number) {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const res = await this.request("POST", `/object/sign/${this.bucket}`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: expiresInS, paths }),
    });
    const rows = (await res.json()) as { path: string | null; signedURL: string | null; error: string | null }[];
    for (const row of rows) {
      if (row.error || !row.signedURL || !row.path) throw new Error(`Couldn't sign ${row.path ?? "a path"}: ${row.error ?? "no URL"}`);
      out.set(row.path, `${this.base}${row.signedURL}`);
    }
    return out;
  }
}
