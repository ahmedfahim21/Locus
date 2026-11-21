/**
 * Creates or replaces one recipient's home profile from a JSON file.
 * Usage: pnpm --filter @locus/api seed:home path/to/home.json
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config.js";
import * as schema from "../db/schema.js";
import { encodeDigipin } from "../digipin/digipin.js";
import { PostgresStore } from "../store/postgres.js";

const latLon = z.object({ lat: z.number(), lon: z.number() });
const file = z
  .object({
    recipient: z.object({
      id: z.string().min(1),
      firstName: z.string().min(1),
      platforms: z.array(z.string().min(1)).min(1),
      fallbackNote: z.string().min(1),
      phone: z.string().regex(/^\+\d{8,15}$/),
    }),
    did: z.string().regex(/^\+\d{8,15}$/),
    provider: z.enum(["plivo", "exotel"]),
    handoffPoint: latLon,
    cues: z
      .array(z.object({ text: z.string().min(1), landmark: z.string().min(1), location: latLon }))
      .min(1),
  })
  .strict();

const path = process.argv[2];
if (!path) throw new Error("Usage: seed:home <path/to/home.json>");
const data = file.parse(JSON.parse(readFileSync(path, "utf8")));

const store = new PostgresStore(env("DATABASE_URL"));
const homeId = `home_${data.recipient.id}`;
const digipin = encodeDigipin(data.handoffPoint);

await store.db.transaction(async (tx) => {
  await tx
    .insert(schema.recipients)
    .values({ ...data.recipient, expectingDeliveryUntil: null })
    .onConflictDoUpdate({
      target: schema.recipients.id,
      set: {
        firstName: data.recipient.firstName,
        platforms: data.recipient.platforms,
        fallbackNote: data.recipient.fallbackNote,
        phone: data.recipient.phone,
      },
    });
  await tx.delete(schema.homeProfiles).where(eq(schema.homeProfiles.recipientId, data.recipient.id));
  await tx.insert(schema.homeProfiles).values({
    id: homeId,
    recipientId: data.recipient.id,
    lat: data.handoffPoint.lat,
    lon: data.handoffPoint.lon,
    digipin,
    confirmedAt: new Date(),
  });
  await tx.insert(schema.cues).values(
    data.cues.map((c, i) => ({
      id: `${homeId}_cue_${i + 1}`,
      homeProfileId: homeId,
      ordinal: i + 1,
      text: c.text,
      landmark: c.landmark,
      lat: c.location.lat,
      lon: c.location.lon,
    })),
  );
  await tx
    .insert(schema.numbers)
    .values({ did: data.did, recipientId: data.recipient.id, provider: data.provider })
    .onConflictDoUpdate({ target: schema.numbers.did, set: { recipientId: data.recipient.id, provider: data.provider } });
});

console.log(`Seeded ${data.recipient.id}: ${data.cues.length} cues, DIGIPIN ${digipin}, DID ${data.did}`);
await store.close();
