/**
 * One-off backfill for per-state landmark names: typed landmarks whose script names
 * don't suit their home's state (Kannada names on a Hyderabad home) are translated
 * again, and walk/photo landmarks lose a local name in another state's script.
 * Latin aliases are kept. Safe to run twice: what already fits is left alone.
 *
 *   pnpm --filter @locus/api state:names            dry run: prints what would change
 *   pnpm --filter @locus/api state:names --apply    writes it
 */
import { eq } from "drizzle-orm";
import { env } from "../config.js";
import * as schema from "../db/schema.js";
import { namesFitState, SarvamTranslator } from "../enrich/translate.js";
import { languageOfScript, localLanguageAt } from "../geo/region.js";
import { PostgresStore } from "../store/postgres.js";

const apply = process.argv.includes("--apply");
const isScript = (n: string) => /[^\x00-\x7f]/.test(n);
const store = new PostgresStore(env("DATABASE_URL"));
const translator = new SarvamTranslator(env("SARVAM_API_KEY"), () => {});
let changed = 0;

try {
  const homes = await store.db.select().from(schema.homeProfiles);
  for (const home of homes) {
    const local = localLanguageAt({ lat: home.lat, lon: home.lon });
    const cues = await store.db.select().from(schema.cues).where(eq(schema.cues.homeProfileId, home.id));
    for (const cue of cues) {
      if (cue.source !== "typed") continue;
      const scripts = cue.aliases.filter(isScript);
      if (namesFitState(scripts, local)) continue;
      const names = await translator.translate(cue.landmark, local);
      const aliases = [...cue.aliases.filter((a) => !isScript(a)), names.hi, ...(names.local ? [names.local] : [])];
      console.log(`${home.recipientId} "${cue.landmark}" (${local?.name ?? "Hindi only"}): ${scripts.join(", ") || "none"} -> ${aliases.filter(isScript).join(", ")}`);
      changed++;
      if (apply) await store.db.update(schema.cues).set({ aliases }).where(eq(schema.cues.id, cue.id));
    }
    const proposals = await store.db.select().from(schema.walkProposals).where(eq(schema.walkProposals.recipientId, home.recipientId));
    for (const p of proposals) {
      if (!p.nameLocal || languageOfScript(p.nameLocal) === local) continue;
      console.log(`${home.recipientId} proposal "${p.name}": drop ${p.nameLocal} (home is ${local?.name ?? "Hindi only"})`);
      changed++;
      if (apply) await store.db.update(schema.walkProposals).set({ nameLocal: null }).where(eq(schema.walkProposals.id, p.id));
    }
  }
  console.log(`${changed} change${changed === 1 ? "" : "s"} ${apply ? "written" : "found (dry run; pass --apply to write)"}`);
} finally {
  await store.close();
}
