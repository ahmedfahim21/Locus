import type { LatLon } from "../domain/types.js";

export type StreetLook = { location: LatLon; heading: number };
export type StreetImage = { look: StreetLook; jpeg: Buffer };

/** Fetches street-level images for points along a route. */
export interface StreetImagery {
  images(looks: StreetLook[]): Promise<StreetImage[]>;
}

/**
 * Google Street View Static API. Chosen by the product owner for detection
 * (2026-11-22) despite Google Maps Platform terms on analysing imagery; images
 * are passed to the vision model and never stored or shown as landmark photos.
 */
export class GoogleStreetView implements StreetImagery {
  constructor(
    private readonly apiKey: string,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  private url(path: string, params: Record<string, string>) {
    const u = new URL(`https://maps.googleapis.com/maps/api/streetview${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("key", this.apiKey);
    return u;
  }

  async images(looks: StreetLook[]): Promise<StreetImage[]> {
    const started = Date.now();
    const out: StreetImage[] = [];
    // One metadata check per distinct point (free), then the images that exist.
    const covered = new Map<string, boolean>();
    for (const look of looks) {
      const key = `${look.location.lat.toFixed(6)},${look.location.lon.toFixed(6)}`;
      if (!covered.has(key)) {
        const res = await fetch(this.url("/metadata", { location: key, radius: "30", source: "outdoor" }));
        if (!res.ok) throw new Error(`Street View metadata returned ${res.status}: ${await res.text()}`);
        const meta = (await res.json()) as { status: string; error_message?: string };
        if (meta.status === "REQUEST_DENIED" || meta.status === "OVER_QUERY_LIMIT") {
          throw new Error(`Street View ${meta.status}: ${meta.error_message ?? "check the key and that the Street View Static API is enabled"}`);
        }
        covered.set(key, meta.status === "OK");
      }
      if (!covered.get(key)) continue;
      const res = await fetch(
        this.url("", { size: "640x400", location: key, heading: String(Math.round(look.heading)), fov: "80", pitch: "4", radius: "30", source: "outdoor", return_error_code: "true" }),
      );
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Street View image returned ${res.status}: ${await res.text()}`);
      out.push({ look, jpeg: Buffer.from(await res.arrayBuffer()) });
    }
    this.log({ event: "streetview.images", looks: looks.length, covered: [...covered.values()].filter(Boolean).length, images: out.length, ms: Date.now() - started });
    return out;
  }
}
