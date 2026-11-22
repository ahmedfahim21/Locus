import type { LatLon } from "./api";

/**
 * How each kind of landmark stands up in the 3D view: height and footprint in
 * metres, footprint shape, and a colour used when the walk video gave none.
 */
const KINDS: Record<string, { height: number; radius: number; sides: number; color: string }> = {
  gate: { height: 2.6, radius: 2.2, sides: 4, color: "#8d939b" },
  tree: { height: 9, radius: 3, sides: 12, color: "#2f9e44" },
  temple: { height: 12, radius: 4, sides: 8, color: "#f08c00" },
  mosque: { height: 12, radius: 4, sides: 12, color: "#51cf66" },
  church: { height: 12, radius: 4, sides: 4, color: "#e9ecef" },
  school: { height: 9, radius: 6, sides: 4, color: "#fab005" },
  hospital: { height: 12, radius: 6, sides: 4, color: "#fa5252" },
  pharmacy: { height: 5, radius: 3, sides: 4, color: "#2fa56a" },
  petrol_pump: { height: 6, radius: 5, sides: 4, color: "#e03131" },
  bank_atm: { height: 4, radius: 2.5, sides: 4, color: "#1c7ed6" },
  bus_stop: { height: 3.5, radius: 5, sides: 4, color: "#4dabf7" },
  // A gully opening: a flat marker on the ground; a street-name board: a thin post.
  lane: { height: 0.6, radius: 3, sides: 4, color: "#e9ecef" },
  sign: { height: 4, radius: 0.8, sides: 4, color: "#2b8a3e" },
  shop: { height: 5, radius: 3.5, sides: 4, color: "#ff922b" },
  food: { height: 5, radius: 3.5, sides: 4, color: "#ff922b" },
  building: { height: 10, radius: 6, sides: 4, color: "#adb5bd" },
  park: { height: 1, radius: 8, sides: 16, color: "#69db7c" },
  other: { height: 4, radius: 3, sides: 4, color: "#ced4da" },
};
/** Props are drawn larger than life so they read at street zoom: this is a schematic, not a survey. */
const SCALE = 3;
/** A typed landmark (no kind from video): a gold marker post. */
const TYPED = { height: 3, radius: 1.6, sides: 8, color: "#f3d27a" };

export type Prop3D = { location: LatLon; kind?: string | null; color?: string | null };

type PropFeature = {
  type: "Feature";
  properties: { height: number; color: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
};

function footprint(at: LatLon, radius: number, sides: number): number[][] {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((at.lat * Math.PI) / 180);
  const ring: number[][] = [];
  const turn = sides === 4 ? Math.PI / 4 : 0;
  for (let i = 0; i <= sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2;
    ring.push([at.lon + (Math.cos(a) * radius) / mPerDegLon, at.lat + (Math.sin(a) * radius) / mPerDegLat]);
  }
  return ring;
}

export function propsCollection(props: Prop3D[]): { type: "FeatureCollection"; features: PropFeature[] } {
  return {
    type: "FeatureCollection",
    features: props.map((p) => {
      const spec = p.kind ? (KINDS[p.kind] ?? KINDS.other!) : TYPED;
      return {
        type: "Feature",
        properties: { height: spec.height * SCALE, color: p.color ?? spec.color },
        geometry: { type: "Polygon", coordinates: [footprint(p.location, spec.radius * SCALE, spec.sides)] },
      };
    }),
  };
}
