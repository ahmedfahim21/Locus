import { nameKey, similarity } from "../clues/normalize.js";
import type { LatLon, OsmFeature, WalkProposal } from "../domain/types.js";
import { distanceM } from "../geo/distance.js";
import type { LandmarkVision } from "../enrich/vision.js";
import { cumulative, pointAt, project, bearing, type RoutePlan } from "./routePlan.js";
import type { StreetImage, StreetImagery } from "./streetView.js";

export type SuggestionSource = "map" | "video" | "street";

export type Suggestion = {
  id: string;
  name: string;
  nameHi: string | null;
  nameKn: string | null;
  aliases: string[];
  kind: string | null;
  color: string | null;
  location: LatLon;
  /** Metres from the main-road entry. */
  alongM: number;
  sources: SuggestionSource[];
  osmId: string | null;
  /** Walk proposal to keep (gives the landmark its photo). */
  proposalId: string | null;
  photoUrl: string | null;
  /** Drafted instruction, said when the rider is at this landmark. */
  text: string;
  /** Pre-selected in the review screen. */
  recommended: boolean;
};

/** A place this far off the route isn't something the rider passes. */
export const NEAR_ROUTE_M = 35;
/** Street View looks are taken this far apart along the route. */
export const STREET_SPACING_M = 40;
const MAX_LOOK_POINTS = 12;
const MAX_RECOMMENDED = 6;
const MIN_SPACING_M = 45;

/** OSM kinds riders actually navigate by, best first. */
const KIND_RANK: Record<string, number> = {
  place_of_worship: 9, fuel: 9, school: 8, hospital: 8, clinic: 7, pharmacy: 7, bank: 6, atm: 6,
  restaurant: 6, cafe: 6, fast_food: 6, bakery: 6, supermarket: 6, convenience: 5, marketplace: 6,
  park: 5, hotel: 5, college: 6, police: 7, post_office: 6, bus_station: 7,
};
const MAP_KIND_TO_PROP: Record<string, string> = {
  place_of_worship: "temple", fuel: "petrol_pump", school: "school", college: "school", hospital: "hospital",
  clinic: "hospital", pharmacy: "pharmacy", bank: "bank_atm", atm: "bank_atm", park: "park",
  restaurant: "food", cafe: "food", fast_food: "food", bakery: "food", hotel: "building",
};

/** How much a source's position can be trusted: the recipient's own GPS, then the map, then a camera position. */
const POSITION_TRUST: Record<SuggestionSource, number> = { video: 3, map: 2, street: 1 };

type Draft = Omit<Suggestion, "id" | "text" | "recommended"> & { score: number; positionTrust: number };

/** The instruction for a landmark: the next turn after it, or the door, or straight on. */
export function draftText(name: string, alongM: number, route: RoutePlan): string {
  const turn = route.turns.find((t) => t.atM >= alongM - 10 && t.atM - alongM <= 90);
  if (turn) return `${name} ke baad ${turn.direction} mudiye${turn.onto ? `, ${turn.onto} pe` : ""}.`;
  if (route.lengthM - alongM <= 70) return `${name} ke paas hi gate hai, wahin rukiye.`;
  return `${name} se seedha aaiye.`;
}

/**
 * Same place from two sources: same name (fuzzy) close by. A Street View
 * sighting is placed where the camera stood, which can be tens of metres from
 * the landmark itself, so it gets more room.
 */
function samePlace(a: Draft, b: Draft): boolean {
  const room = a.sources.includes("street") || b.sources.includes("street") ? 90 : 60;
  if (distanceM(a.location, b.location) > room) return false;
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  return ka === kb || similarity(ka, kb) >= 0.8 || ka.includes(kb) || kb.includes(ka);
}

function merge(into: Draft, other: Draft) {
  for (const s of other.sources) if (!into.sources.includes(s)) into.sources.push(s);
  into.osmId ??= other.osmId;
  into.proposalId ??= other.proposalId;
  into.photoUrl ??= other.photoUrl;
  into.nameHi ??= other.nameHi;
  into.nameKn ??= other.nameKn;
  into.color ??= other.color;
  into.kind ??= other.kind;
  into.aliases = [...new Set([...into.aliases, ...other.aliases, other.name])].filter((n) => nameKey(n) !== nameKey(into.name));
  if (other.positionTrust > into.positionTrust) {
    into.location = other.location;
    into.alongM = other.alongM;
    into.positionTrust = other.positionTrust;
  }
  into.score += other.score + 2;
}

/** Street View looks: every ~40 m, facing each side of the road. */
export function streetLooks(route: RoutePlan): { location: LatLon; heading: number; alongM: number }[] {
  const cum = cumulative(route.line);
  const count = Math.min(MAX_LOOK_POINTS, Math.floor(route.lengthM / STREET_SPACING_M) + 1);
  const step = route.lengthM / Math.max(1, count);
  const looks: { location: LatLon; heading: number; alongM: number }[] = [];
  for (let k = 0; k < count; k++) {
    const d = Math.min(route.lengthM, k * step + step / 2);
    const at = pointAt(route.line, cum, d);
    const ahead = pointAt(route.line, cum, Math.min(route.lengthM, d + 10));
    const heading = bearing(at, ahead);
    looks.push({ location: at, heading: (heading + 270) % 360, alongM: d }, { location: at, heading: (heading + 90) % 360, alongM: d });
  }
  return looks;
}

/**
 * Landmark suggestions along the route from the map, the recipient's walk
 * video and Street View, merged so each place appears once with every source
 * that saw it. The best few, spread along the route and favouring turns, are
 * pre-selected.
 */
export async function suggestLandmarks(input: {
  route: RoutePlan;
  features: OsmFeature[];
  proposals: (WalkProposal & { photoUrl: string | null })[];
  street: { imagery: StreetImagery; vision: LandmarkVision } | null;
  log: (event: Record<string, unknown>) => void;
}): Promise<{ suggestions: Suggestion[]; streetView: { status: "ok" | "off" | "error"; message?: string; found?: number } }> {
  const { route } = input;
  const cum = cumulative(route.line);
  const drafts: Draft[] = [];
  const near = (p: LatLon) => {
    const pr = project(route.line, cum, p);
    return pr.offM <= NEAR_ROUTE_M && pr.alongM < route.lengthM + 10 ? pr : null;
  };
  const turnBonus = (alongM: number) => (route.turns.some((t) => t.atM >= alongM - 10 && t.atM - alongM <= 60) ? 4 : 0);

  for (const f of input.features) {
    const pr = near(f.location);
    if (!pr) continue;
    drafts.push({
      name: f.name, nameHi: null, nameKn: null, aliases: f.altNames, kind: MAP_KIND_TO_PROP[f.kind] ?? "shop", color: null,
      location: f.location, alongM: pr.alongM, sources: ["map"], positionTrust: POSITION_TRUST.map, osmId: f.osmId, proposalId: null, photoUrl: null,
      score: (KIND_RANK[f.kind] ?? 3) + turnBonus(pr.alongM) - pr.offM / 20,
    });
  }

  for (const p of input.proposals) {
    if (p.status === "rejected" || !p.framePath) continue;
    const pr = project(route.line, cum, p.location);
    if (pr.offM > 60) continue;
    drafts.push({
      name: p.name, nameHi: p.nameHi, nameKn: p.nameKn, aliases: p.aliases, kind: p.kind, color: p.color,
      location: p.location, alongM: pr.alongM, sources: ["video"], positionTrust: POSITION_TRUST.video, osmId: p.osmId, proposalId: p.id, photoUrl: p.photoUrl,
      score: 8 + turnBonus(pr.alongM),
    });
  }

  let streetView: { status: "ok" | "off" | "error"; message?: string; found?: number } = { status: "off" };
  if (input.street) {
    try {
      const looks = streetLooks(route);
      const images = await input.street.imagery.images(looks);
      // The imagery returns the same look objects it was given.
      const lookOf = (im: StreetImage) => looks.find((x) => x === im.look)!;
      const found = images.length
        ? await input.street.vision.find(images.map((im, index) => ({ index, jpeg: im.jpeg, distanceM: lookOf(im).alongM })))
        : [];
      for (const l of found) {
        const im = images[l.frame];
        if (!im || !l.name.trim()) continue;
        const look = lookOf(im);
        // The landmark stands beside the road, on the side the camera faced.
        const side = { lat: look.location.lat + (Math.cos(toRad(look.heading)) * 10) / 111_320, lon: look.location.lon + (Math.sin(toRad(look.heading)) * 10) / (111_320 * Math.cos(toRad(look.location.lat))) };
        drafts.push({
          name: l.name.trim(), nameHi: l.nameHi.trim() || null, nameKn: l.nameKn.trim() || null, aliases: l.aliases, kind: l.kind,
          color: /^#[0-9a-f]{6}$/i.test(l.color.trim()) ? l.color.trim().toLowerCase() : null,
          location: side, alongM: look.alongM, sources: ["street"], positionTrust: POSITION_TRUST.street, osmId: null, proposalId: null, photoUrl: null,
          score: 7 + turnBonus(look.alongM),
        });
      }
      streetView = { status: "ok", found: found.length };
    } catch (err) {
      input.log({ event: "suggest.streetview_failed", message: (err as Error).message });
      streetView = { status: "error", message: (err as Error).message };
    }
  }

  // One entry per place, in route order.
  const merged: Draft[] = [];
  for (const d of drafts.sort((a, b) => b.sources.length - a.sources.length || b.score - a.score)) {
    const same = merged.find((m) => samePlace(m, d));
    if (same) merge(same, d);
    else merged.push({ ...d, sources: [...d.sources], aliases: [...d.aliases] });
  }
  merged.sort((a, b) => a.alongM - b.alongM);

  // Pre-select: best per stretch, spread out, at most six.
  const chosen = new Set<Draft>();
  for (const d of [...merged].sort((a, b) => b.score - a.score)) {
    if (chosen.size >= MAX_RECOMMENDED) break;
    if ([...chosen].some((c) => Math.abs(c.alongM - d.alongM) < MIN_SPACING_M)) continue;
    chosen.add(d);
  }

  return {
    streetView,
    suggestions: merged.map((d, i) => ({
      id: `sug_${i + 1}`,
      name: d.name, nameHi: d.nameHi, nameKn: d.nameKn, aliases: d.aliases, kind: d.kind, color: d.color,
      location: d.location, alongM: Math.round(d.alongM), sources: d.sources, osmId: d.osmId,
      proposalId: d.proposalId, photoUrl: d.photoUrl,
      text: draftText(d.name, d.alongM, route),
      recommended: chosen.has(d),
    })),
  };
}

const toRad = (d: number) => (d * Math.PI) / 180;
