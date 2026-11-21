import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** PostGIS geography (always a point, SRID 4326), generated from the lat/lon columns. */
const geographyPoint = customType<{ data: string }>({
  dataType: () => "geography",
});
/** Locus stores its tables in the `locus` Postgres schema. */
export const locus = pgSchema("locus");

const pointFrom = (lat: string, lon: string) =>
  sql.raw(`(ST_SetSRID(ST_MakePoint("${lon}", "${lat}"), 4326)::geography)`);

export const apiClients = locus.table("apiClients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("keyHash").notNull().unique(),
  firstParty: boolean("firstParty").notNull().default(false),
});

export const recipients = locus.table("recipients", {
  id: text("id").primaryKey(),
  authSubject: text("authSubject").unique(),
  firstName: text("firstName").notNull(),
  platforms: text("platforms").array().notNull(),
  expectingDeliveryUntil: timestamp("expectingDeliveryUntil", { withTimezone: true }),
  fallbackNote: text("fallbackNote").notNull(),
  phone: text("phone").notNull(),
});

export const homeProfiles = locus.table("homeProfiles", {
  id: text("id").primaryKey(),
  recipientId: text("recipientId")
    .notNull()
    .unique()
    .references(() => recipients.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  location: geographyPoint("location").generatedAlwaysAs(pointFrom("lat", "lon")),
  digipin: text("digipin").notNull(),
  confirmedAt: timestamp("confirmedAt", { withTimezone: true }).notNull(),
});

export const cues = locus.table(
  "cues",
  {
    id: text("id").primaryKey(),
    homeProfileId: text("homeProfileId")
      .notNull()
      .references(() => homeProfiles.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    landmark: text("landmark").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    source: text("source").notNull().default("typed"),
    photoPath: text("photoPath"),
    kind: text("kind"),
    color: text("color"),
  },
  (t) => [index("cuesHomeProfileIdx").on(t.homeProfileId)],
);

export const walks = locus.table(
  "walks",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipientId")
      .notNull()
      .references(() => recipients.id, { onDelete: "cascade" }),
    videoPath: text("videoPath").notNull(),
    contentType: text("contentType").notNull(),
    durationS: doublePrecision("durationS").notNull(),
    /** GPS track, read and written whole with the walk. */
    track: jsonb("track").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    processedAt: timestamp("processedAt", { withTimezone: true }),
    videoDeletedAt: timestamp("videoDeletedAt", { withTimezone: true }),
  },
  (t) => [index("walksRecipientIdx").on(t.recipientId)],
);

export const walkProposals = locus.table(
  "walkProposals",
  {
    id: text("id").primaryKey(),
    walkId: text("walkId")
      .notNull()
      .references(() => walks.id, { onDelete: "cascade" }),
    recipientId: text("recipientId")
      .notNull()
      .references(() => recipients.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    nameHi: text("nameHi"),
    nameKn: text("nameKn"),
    aliases: text("aliases").array().notNull(),
    kind: text("kind").notNull(),
    color: text("color"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    osmId: text("osmId"),
    framePath: text("framePath"),
    atS: doublePrecision("atS").notNull(),
    status: text("status").notNull(),
  },
  (t) => [index("walkProposalsWalkIdx").on(t.walkId), index("walkProposalsRecipientIdx").on(t.recipientId)],
);

export const numbers = locus.table("numbers", {
  did: text("did").primaryKey(),
  recipientId: text("recipientId")
    .notNull()
    .references(() => recipients.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
});

/** Locus's outbound caller IDs (handoff calls), for the loop guard. */
export const outboundNumbers = locus.table("outboundNumbers", {
  e164: text("e164").primaryKey(),
});

export const osmFeatures = locus.table(
  "osmFeatures",
  {
    osmId: text("osmId").primaryKey(),
    name: text("name").notNull(),
    altNames: text("altNames").array().notNull(),
    kind: text("kind").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    location: geographyPoint("location").generatedAlwaysAs(pointFrom("lat", "lon")),
  },
  (t) => [index("osmFeaturesLocationIdx").using("gist", t.location)],
);

export const osmWays = locus.table("osmWays", {
  osmId: text("osmId").primaryKey(),
  name: text("name"),
});

export const osmWayNodes = locus.table(
  "osmWayNodes",
  {
    wayId: text("wayId")
      .notNull()
      .references(() => osmWays.osmId, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    nodeId: text("nodeId").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    location: geographyPoint("location").generatedAlwaysAs(pointFrom("lat", "lon")),
  },
  (t) => [primaryKey({ columns: [t.wayId, t.seq] }), index("osmWayNodesLocationIdx").using("gist", t.location)],
);

export const sessions = locus.table(
  "sessions",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => apiClients.id),
    recipientId: text("recipientId")
      .notNull()
      .references(() => recipients.id, { onDelete: "cascade" }),
    callerIdHash: text("callerIdHash"),
    state: text("state").notNull(),
    mode: text("mode").notNull(),
    language: text("language").notNull(),
    currentCue: integer("currentCue").notNull(),
    lostTurns: integer("lostTurns").notNull(),
    /** Read and written whole with the session. */
    screening: jsonb("screening").notNull(),
    handoffStartedAt: timestamp("handoffStartedAt", { withTimezone: true }),
    handoffEndedAt: timestamp("handoffEndedAt", { withTimezone: true }),
    handoffAnswered: boolean("handoffAnswered"),
    message: text("message"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
  },
  (t) => [index("sessionsRecipientHandoffIdx").on(t.recipientId, t.handoffStartedAt)],
);

export const turns = locus.table(
  "turns",
  {
    id: serial("id").primaryKey(),
    sessionId: text("sessionId")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    utterance: text("utterance"),
    matchedCueId: text("matchedCueId"),
    matchedOsmId: text("matchedOsmId"),
    instruction: text("instruction").notNull(),
    lost: boolean("lost").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  },
  (t) => [index("turnsSessionIdx").on(t.sessionId)],
);
