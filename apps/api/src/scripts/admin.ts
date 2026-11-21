/**
 * Small admin commands.
 *   pnpm --filter @locus/api admin client <name> [--first-party]   create an API client; prints its key once
 *   pnpm --filter @locus/api admin expect <recipientId>    switch "expecting a delivery" on for 3 hours
 *   pnpm --filter @locus/api admin outbound <+E164>        register a Locus outbound number (loop guard)
 */
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sha256 } from "../app.js";
import { env } from "../config.js";
import * as schema from "../db/schema.js";
import { EXPECTING_DELIVERY_MS } from "../domain/types.js";
import { PostgresStore } from "../store/postgres.js";


const [command, arg] = process.argv.slice(2);
if (!command || !arg) throw new Error("Usage: admin <client|expect|outbound> <arg>");

const store = new PostgresStore(env("DATABASE_URL"));
try {
  if (command === "client") {
    const key = `locus_${randomBytes(24).toString("base64url")}`;
    const id = `client_${randomUUID()}`;
    const firstParty = process.argv[4] === "--first-party";
    await store.db.insert(schema.apiClients).values({ id, name: arg, keyHash: sha256(key), firstParty });
    console.log(`Created ${id} (${arg}). API key (shown once, store it in an env var):\n${key}`);
  } else if (command === "expect") {
    const until = new Date(Date.now() + EXPECTING_DELIVERY_MS);
    const updated = await store.db
      .update(schema.recipients)
      .set({ expectingDeliveryUntil: until })
      .where(eq(schema.recipients.id, arg))
      .returning({ id: schema.recipients.id });
    if (updated.length !== 1) throw new Error(`Recipient ${arg} not found`);
    console.log(`${arg} is expecting a delivery until ${until.toISOString()}`);
  } else if (command === "outbound") {
    if (!/^\+\d{8,15}$/.test(arg)) throw new Error("Outbound number must be E.164, e.g. +918000000099");
    await store.db.insert(schema.outboundNumbers).values({ e164: arg }).onConflictDoNothing();
    console.log(`Registered outbound number ${arg}`);
  } else {
    throw new Error(`Unknown command ${command}`);
  }
} finally {
  await store.close();
}
