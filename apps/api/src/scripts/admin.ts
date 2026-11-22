/**
 * Small admin commands.
 *   pnpm --filter @locus/api admin client <name> [--first-party]   create an API client; prints its key once
 *   pnpm --filter @locus/api admin expect <recipientId>    switch "expecting a delivery" on for 3 hours
 *   pnpm --filter @locus/api admin outbound <+E164>        register a Locus outbound number (loop guard)
 *   pnpm --filter @locus/api admin number <+E164> <recipientId> [provider]   assign a Locus number to a recipient
 *   pnpm --filter @locus/api admin unnumber <+E164>        remove a Locus number
 *   pnpm --filter @locus/api admin trunk <+E164>           create LiveKit's outbound SIP trunk for this Locus number,
 *                                                          from VOBIZ_SIP_DOMAIN / _USERNAME / _PASSWORD; prints its id
 *   pnpm --filter @locus/api admin dial <+E164>            demo: Locus rings this phone as if the rider had called the
 *                                                          Locus number (LIVEKIT_SIP_OUTBOUND_TRUNK_ID, LOCUS_OUTBOUND_NUMBER)
 */
import { randomBytes, randomUUID } from "node:crypto";
import { SIPTransport } from "@livekit/protocol";
import { eq } from "drizzle-orm";
import { AgentDispatchClient, SipClient } from "livekit-server-sdk";
import { sha256 } from "../app.js";
import { env } from "../config.js";
import * as schema from "../db/schema.js";
import { EXPECTING_DELIVERY_MS } from "../domain/types.js";
import { PostgresStore } from "../store/postgres.js";


const [command, arg] = process.argv.slice(2);
if (!command || !arg) throw new Error("Usage: admin <client|expect|outbound|number|unnumber|trunk|dial> <arg>");
const E164 = /^\+\d{8,15}$/;

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
  } else if (command === "number") {
    const recipientId = process.argv[4];
    if (!/^\+\d{8,15}$/.test(arg)) throw new Error("Number must be E.164, e.g. +918047182290");
    if (!recipientId || !(await store.getRecipient(recipientId))) throw new Error(`Recipient ${recipientId ?? "(missing)"} not found`);
    const provider = process.argv[5] ?? "dev";
    await store.db
      .insert(schema.numbers)
      .values({ did: arg, recipientId, provider })
      .onConflictDoUpdate({ target: schema.numbers.did, set: { recipientId, provider } });
    console.log(`${arg} now rings ${recipientId} (${provider})`);
  } else if (command === "unnumber") {
    const removed = await store.db.delete(schema.numbers).where(eq(schema.numbers.did, arg)).returning({ did: schema.numbers.did });
    if (removed.length !== 1) throw new Error(`Number ${arg} not found`);
    console.log(`Removed ${arg}`);
  } else if (command === "trunk") {
    // The provider's SIP credentials stay in env; only the new trunk's id is printed.
    if (!E164.test(arg)) throw new Error("The Locus number must be E.164, e.g. +918065354620");
    const sip = new SipClient(env("LIVEKIT_URL"), env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"));
    const trunk = await sip.createSipOutboundTrunk(`locus-${arg}`, env("VOBIZ_SIP_DOMAIN"), [arg], {
      transport: SIPTransport.SIP_TRANSPORT_AUTO,
      authUsername: env("VOBIZ_SIP_USERNAME"),
      authPassword: env("VOBIZ_SIP_PASSWORD"),
    });
    console.log(`Created outbound trunk for ${arg}. Set it in .env and on the server:\nLIVEKIT_SIP_OUTBOUND_TRUNK_ID=${trunk.sipTrunkId}\nLOCUS_OUTBOUND_NUMBER=${arg}`);
  } else if (command === "dial") {
    // Demo without inbound calling: Locus rings a phone from the Locus number. The worker sees the call's
    // trunk number (the Locus number) exactly as on an inbound call, so the same recipient, screening and
    // guidance apply. That number must be assigned with `admin number` and the recipient expecting a delivery.
    if (!E164.test(arg)) throw new Error("Phone must be E.164, e.g. +919812345678");
    const url = env("LIVEKIT_URL");
    const room = `dial-${randomUUID()}`;
    await new AgentDispatchClient(url, env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET")).createDispatch(room, "locus-guide");
    console.log(`Ringing ${arg} from ${env("LOCUS_OUTBOUND_NUMBER")} (room ${room})…`);
    const sip = new SipClient(url, env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"));
    const rider = await sip.createSipParticipant(env("LIVEKIT_SIP_OUTBOUND_TRUNK_ID"), arg, room, {
      participantIdentity: "rider",
      fromNumber: env("LOCUS_OUTBOUND_NUMBER"),
      ringingTimeout: 40,
      waitUntilAnswered: true,
    });
    console.log(`Answered (${rider.participantIdentity}). Locus is on the line; play the rider.`);
  } else {
    throw new Error(`Unknown command ${command}`);
  }
} finally {
  await store.close();
}
