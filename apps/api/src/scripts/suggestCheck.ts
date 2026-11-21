/**
 * Prints the setup suggestions for a recipient's saved door, from real data:
 * the route from the nearest main road with its turns, and landmarks from the
 * map, their walk video and (with GOOGLE_MAPS_API_KEY) Street View.
 *
 * Usage: pnpm --filter @locus/api suggest:check <recipientId>
 */
import { SEARCH_RADIUS_M } from "../app.js";
import { env, optionalEnv } from "../config.js";
import { OpenAIVision } from "../enrich/vision.js";
import { RoadGraph } from "../geo/roadGraph.js";
import { planRoute } from "../onboarding/routePlan.js";
import { GoogleStreetView } from "../onboarding/streetView.js";
import { suggestLandmarks } from "../onboarding/suggest.js";
import { PostgresStore } from "../store/postgres.js";

const recipientId = process.argv[2];
if (!recipientId) throw new Error("Usage: suggest:check <recipientId>");
const log = (e: Record<string, unknown>) => console.error(JSON.stringify(e));
const store = new PostgresStore(env("DATABASE_URL"));
try {
  const home = await store.getHomeProfile(recipientId);
  if (!home) throw new Error(`${recipientId} has no saved door`);
  const [ways, features, proposals] = await Promise.all([
    store.nearbyWays(home.handoffPoint, SEARCH_RADIUS_M),
    store.nearbyFeatures(home.handoffPoint, SEARCH_RADIUS_M),
    store.listRecipientProposals(recipientId),
  ]);
  const typed = ways.filter((w) => w.highway).length;
  console.log(`roads: ${ways.length} (${typed} with a type), places: ${features.length}`);
  const route = planRoute(new RoadGraph(ways), home.handoffPoint);
  if (!route) throw new Error("No main road reachable: re-run osm:import so roads have their types");
  console.log(`route: from ${route.entryStreet ?? "(unnamed main road)"} · ${Math.round(route.lengthM)} m`);
  for (const t of route.turns) console.log(`  turn ${t.direction} at ${Math.round(t.atM)} m${t.onto ? ` onto ${t.onto}` : ""}`);
  const key = optionalEnv("GOOGLE_MAPS_API_KEY");
  const result = await suggestLandmarks({
    route,
    features,
    proposals: proposals.filter((p) => p.status !== "rejected" && p.framePath).map((p) => ({ ...p, photoUrl: null })),
    street: key ? { imagery: new GoogleStreetView(key, log), vision: new OpenAIVision(env("OPENAI_API_KEY"), optionalEnv("OPENAI_VISION_MODEL") ?? env("OPENAI_MODEL"), log) } : null,
    log,
  });
  console.log(`street view: ${JSON.stringify(result.streetView)}`);
  for (const s of result.suggestions) {
    console.log(`${s.recommended ? "★" : " "} ${String(s.alongM).padStart(4)} m  ${s.name}  [${s.sources.join("+")}]  "${s.text}"`);
  }
} finally {
  await store.close();
}
