/**
 * Imports named places and roads around a point from the public Overpass API.
 * Usage: pnpm --filter @locus/api osm:import <lat> <lon> [radiusM=700] [--save file.json] [--from file.json]
 * --save keeps the Overpass response; --from imports a saved response instead of calling Overpass
 * (the demo seed uses seed/osm-knowledge-city.json, so it works offline and when Overpass is busy).
 * OSM data © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { env, optionalEnv } from "../config.js";
import * as schema from "../db/schema.js";
import { PostgresStore } from "../store/postgres.js";

type OverpassElement =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: "way"; id: number; nodes?: number[]; tags?: Record<string, string>; center?: { lat: number; lon: number } };

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a file path`);
  argv.splice(i, 2);
  return value;
};
const fromFile = flag("--from");
const saveFile = flag("--save");
const [latArg, lonArg, radiusArg] = argv;
const lat = Number(latArg);
const lon = Number(lonArg);
const radius = Number(radiusArg ?? "700");
if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) {
  throw new Error("Usage: osm:import <lat> <lon> [radiusM]");
}

const endpoint = optionalEnv("OVERPASS_URL") ?? "https://overpass-api.de/api/interpreter";
// Places print with a centre point; roads print with their node ids, then those nodes' coordinates.
const query = `[out:json][timeout:90];
nwr(around:${radius},${lat},${lon})["name"][~"^(amenity|shop|tourism|leisure|building|office|historic|healthcare|craft)$"~"."]->.places;
way(around:${radius},${lat},${lon})["highway"]->.roads;
.places out center tags;
.roads out body;
.roads >;
out skel qt;`;

async function overpass(): Promise<{ elements: OverpassElement[] }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "locus-osm-import/0.1" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as { elements: OverpassElement[] };
}
const response = fromFile ? (JSON.parse(readFileSync(fromFile, "utf8")) as { elements: OverpassElement[] }) : await overpass();
if (!Array.isArray(response.elements)) throw new Error(`${fromFile ?? "Overpass"} has no elements array`);
if (saveFile) writeFileSync(saveFile, JSON.stringify(response));
const { elements } = response;

const nodes = new Map<number, { lat: number; lon: number }>();
for (const e of elements) if (e.type === "node") nodes.set(e.id, { lat: e.lat, lon: e.lon });

const features: (typeof schema.osmFeatures.$inferInsert)[] = [];
const ways: { way: typeof schema.osmWays.$inferInsert; nodes: (typeof schema.osmWayNodes.$inferInsert)[] }[] = [];

for (const e of elements) {
  const tags = e.tags ?? {};
  if (e.type === "way" && tags.highway && e.nodes) {
    const wayId = `way/${e.id}`;
    const wayNodes = e.nodes
      .map((id, seq) => ({ id, seq, loc: nodes.get(id) }))
      .filter((n) => n.loc !== undefined)
      .map((n) => ({ wayId, seq: n.seq, nodeId: `node/${n.id}`, lat: n.loc!.lat, lon: n.loc!.lon }));
    if (wayNodes.length >= 2) ways.push({ way: { osmId: wayId, name: tags.name ?? null, highway: tags.highway ?? null }, nodes: wayNodes });
  }
  if (tags.name && !tags.highway) {
    const loc = e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center;
    if (!loc) continue;
    const altNames = ["name:en", "name:hi", "name:te", "name:kn", "alt_name", "old_name", "brand"]
      .map((k) => tags[k])
      .filter((v): v is string => Boolean(v) && v !== tags.name);
    const kind = tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ?? tags.building ?? tags.office ?? "place";
    features.push({ osmId: `${e.type}/${e.id}`, name: tags.name, altNames, kind, lat: loc.lat, lon: loc.lon });
  }
}

const store = new PostgresStore(env("DATABASE_URL"));
await store.db.transaction(async (tx) => {
  for (const f of features) {
    await tx.insert(schema.osmFeatures).values(f).onConflictDoUpdate({
      target: schema.osmFeatures.osmId,
      set: { name: f.name, altNames: f.altNames, kind: f.kind, lat: f.lat, lon: f.lon },
    });
  }
  for (const w of ways) {
    await tx.insert(schema.osmWays).values(w.way).onConflictDoUpdate({ target: schema.osmWays.osmId, set: { name: w.way.name, highway: w.way.highway } });
    await tx.insert(schema.osmWayNodes).values(w.nodes).onConflictDoNothing();
  }
});
console.log(`Imported ${features.length} named places and ${ways.length} roads within ${radius} m of ${lat},${lon}`);
await store.close();
