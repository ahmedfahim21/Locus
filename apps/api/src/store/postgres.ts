import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.js";
import type { CueSource, HomeProfile, LatLon, OsmWay, ProposalStatus, Recipient, Session, TrackPoint, Turn, Walk, WalkProposal, WalkStatus } from "../domain/types.js";
import type { Store } from "./store.js";

type Db = PostgresJsDatabase<typeof schema>;

const near = (column: unknown, center: LatLon, radiusM: number) =>
  sql`ST_DWithin(${column}, ST_SetSRID(ST_MakePoint(${center.lon}, ${center.lat}), 4326)::geography, ${radiusM})`;

function toSession(row: typeof schema.sessions.$inferSelect): Session {
  return {
    id: row.id,
    clientId: row.clientId,
    recipientId: row.recipientId,
    callerIdHash: row.callerIdHash,
    state: row.state as Session["state"],
    mode: row.mode as Session["mode"],
    language: row.language as Session["language"],
    currentCue: row.currentCue,
    lostTurns: row.lostTurns,
    screening: row.screening as Session["screening"],
    handoff: row.handoffStartedAt
      ? { startedAt: row.handoffStartedAt, endedAt: row.handoffEndedAt, answered: row.handoffAnswered }
      : null,
    message: row.message,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  };
}

function toWalk(row: typeof schema.walks.$inferSelect): Walk {
  return { ...row, track: row.track as TrackPoint[], status: row.status as WalkStatus };
}

function toProposal(row: typeof schema.walkProposals.$inferSelect): WalkProposal {
  const { lat, lon, ...rest } = row;
  return { ...rest, location: { lat, lon }, status: row.status as ProposalStatus };
}

function fromProposal(p: WalkProposal): typeof schema.walkProposals.$inferInsert {
  const { location, ...rest } = p;
  return { ...rest, lat: location.lat, lon: location.lon };
}

function fromSession(s: Session): typeof schema.sessions.$inferInsert {
  return {
    id: s.id,
    clientId: s.clientId,
    recipientId: s.recipientId,
    callerIdHash: s.callerIdHash,
    state: s.state,
    mode: s.mode,
    language: s.language,
    currentCue: s.currentCue,
    lostTurns: s.lostTurns,
    screening: s.screening,
    handoffStartedAt: s.handoff?.startedAt ?? null,
    handoffEndedAt: s.handoff?.endedAt ?? null,
    handoffAnswered: s.handoff?.answered ?? null,
    message: s.message,
    createdAt: s.createdAt,
    endedAt: s.endedAt,
  };
}

export class PostgresStore implements Store {
  readonly db: Db;
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { prepare: false });
    this.db = drizzle(this.sql, { schema });
  }

  async close() {
    await this.sql.end();
  }

  async getClientByKeyHash(keyHash: string) {
    const [row] = await this.db.select().from(schema.apiClients).where(eq(schema.apiClients.keyHash, keyHash));
    return row ?? null;
  }

  async getNumberByDid(did: string) {
    const [row] = await this.db.select().from(schema.numbers).where(eq(schema.numbers.did, did));
    return row ?? null;
  }

  async isLocusNumber(e164: string) {
    const [out] = await this.db.select().from(schema.outboundNumbers).where(eq(schema.outboundNumbers.e164, e164));
    if (out) return true;
    return (await this.getNumberByDid(e164)) !== null;
  }

  async getRecipient(id: string) {
    const [row] = await this.db.select().from(schema.recipients).where(eq(schema.recipients.id, id));
    if (!row) return null;
    return {
      id: row.id,
      firstName: row.firstName,
      platforms: row.platforms,
      expectingDeliveryUntil: row.expectingDeliveryUntil,
      fallbackNote: row.fallbackNote,
      phone: row.phone,
    };
  }

  async getHomeProfile(recipientId: string) {
    const [home] = await this.db
      .select({
        id: schema.homeProfiles.id,
        lat: schema.homeProfiles.lat,
        lon: schema.homeProfiles.lon,
        digipin: schema.homeProfiles.digipin,
        confirmedAt: schema.homeProfiles.confirmedAt,
      })
      .from(schema.homeProfiles)
      .where(eq(schema.homeProfiles.recipientId, recipientId));
    if (!home) return null;
    const cueRows = await this.db
      .select()
      .from(schema.cues)
      .where(eq(schema.cues.homeProfileId, home.id))
      .orderBy(asc(schema.cues.ordinal));
    return {
      id: home.id,
      recipientId,
      handoffPoint: { lat: home.lat, lon: home.lon },
      digipin: home.digipin,
      confirmedAt: home.confirmedAt,
      cues: cueRows.map((c) => ({
        id: c.id,
        ordinal: c.ordinal,
        text: c.text,
        landmark: c.landmark,
        location: { lat: c.lat, lon: c.lon },
        aliases: c.aliases,
        source: c.source as CueSource,
        photoPath: c.photoPath,
      })),
    };
  }

  async nearbyFeatures(center: LatLon, radiusM: number) {
    const rows = await this.db
      .select({
        osmId: schema.osmFeatures.osmId,
        name: schema.osmFeatures.name,
        altNames: schema.osmFeatures.altNames,
        kind: schema.osmFeatures.kind,
        lat: schema.osmFeatures.lat,
        lon: schema.osmFeatures.lon,
      })
      .from(schema.osmFeatures)
      .where(near(schema.osmFeatures.location, center, radiusM));
    return rows.map((r) => ({ osmId: r.osmId, name: r.name, altNames: r.altNames, kind: r.kind, location: { lat: r.lat, lon: r.lon } }));
  }

  async nearbyWays(center: LatLon, radiusM: number): Promise<OsmWay[]> {
    const wayIds = this.db
      .selectDistinct({ wayId: schema.osmWayNodes.wayId })
      .from(schema.osmWayNodes)
      .where(near(schema.osmWayNodes.location, center, radiusM));
    const rows = await this.db
      .select({
        wayId: schema.osmWayNodes.wayId,
        name: schema.osmWays.name,
        nodeId: schema.osmWayNodes.nodeId,
        lat: schema.osmWayNodes.lat,
        lon: schema.osmWayNodes.lon,
      })
      .from(schema.osmWayNodes)
      .innerJoin(schema.osmWays, eq(schema.osmWays.osmId, schema.osmWayNodes.wayId))
      .where(sql`${schema.osmWayNodes.wayId} in ${wayIds}`)
      .orderBy(asc(schema.osmWayNodes.wayId), asc(schema.osmWayNodes.seq));
    const ways = new Map<string, OsmWay>();
    for (const r of rows) {
      let way = ways.get(r.wayId);
      if (!way) {
        way = { osmId: r.wayId, name: r.name, nodes: [] };
        ways.set(r.wayId, way);
      }
      way.nodes.push({ id: r.nodeId, location: { lat: r.lat, lon: r.lon } });
    }
    return [...ways.values()];
  }

  async createSession(session: Session) {
    await this.db.insert(schema.sessions).values(fromSession(session));
  }

  async getSession(id: string) {
    const [row] = await this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    return row ? toSession(row) : null;
  }

  async updateSession(session: Session) {
    const updated = await this.db
      .update(schema.sessions)
      .set(fromSession(session))
      .where(eq(schema.sessions.id, session.id))
      .returning({ id: schema.sessions.id });
    if (updated.length !== 1) throw new Error(`session ${session.id} not found`);
  }

  async latestHandoff(recipientId: string) {
    const [row] = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.recipientId, recipientId), isNotNull(schema.sessions.handoffStartedAt)))
      .orderBy(desc(schema.sessions.handoffStartedAt))
      .limit(1);
    return row ? toSession(row).handoff : null;
  }

  async getRecipientIdByAuthSubject(authSubject: string) {
    const [row] = await this.db
      .select({ id: schema.recipients.id })
      .from(schema.recipients)
      .where(eq(schema.recipients.authSubject, authSubject));
    return row?.id ?? null;
  }

  async saveRecipientProfile(authSubject: string, r: Omit<Recipient, "expectingDeliveryUntil">) {
    await this.db
      .insert(schema.recipients)
      .values({ ...r, authSubject, expectingDeliveryUntil: null })
      .onConflictDoUpdate({
        target: schema.recipients.id,
        set: { firstName: r.firstName, platforms: r.platforms, fallbackNote: r.fallbackNote, phone: r.phone },
      });
  }

  async replaceHomeProfile(home: HomeProfile) {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.homeProfiles).where(eq(schema.homeProfiles.recipientId, home.recipientId));
      await tx.insert(schema.homeProfiles).values({
        id: home.id,
        recipientId: home.recipientId,
        lat: home.handoffPoint.lat,
        lon: home.handoffPoint.lon,
        digipin: home.digipin,
        confirmedAt: home.confirmedAt,
      });
      await tx.insert(schema.cues).values(
        home.cues.map((c) => ({
          id: c.id,
          homeProfileId: home.id,
          ordinal: c.ordinal,
          text: c.text,
          landmark: c.landmark,
          lat: c.location.lat,
          lon: c.location.lon,
          aliases: c.aliases,
          source: c.source,
          photoPath: c.photoPath,
        })),
      );
    });
  }

  async setExpectingDelivery(recipientId: string, until: Date | null) {
    const updated = await this.db
      .update(schema.recipients)
      .set({ expectingDeliveryUntil: until })
      .where(eq(schema.recipients.id, recipientId))
      .returning({ id: schema.recipients.id });
    if (updated.length !== 1) throw new Error(`recipient ${recipientId} not found`);
  }

  async getNumberForRecipient(recipientId: string) {
    const [row] = await this.db.select().from(schema.numbers).where(eq(schema.numbers.recipientId, recipientId)).limit(1);
    return row ?? null;
  }

  async listRecentSessions(recipientId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.recipientId, recipientId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(limit);
    return rows.map(toSession);
  }

  async addTurn(turn: Turn) {
    await this.db.insert(schema.turns).values(turn);
  }

  async listTurns(sessionId: string) {
    const rows = await this.db
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.sessionId, sessionId))
      .orderBy(asc(schema.turns.id));
    return rows.map(({ id: _id, ...t }) => t);
  }

  async createWalk(walk: Walk) {
    await this.db.insert(schema.walks).values(walk);
  }

  async getWalk(id: string) {
    const [row] = await this.db.select().from(schema.walks).where(eq(schema.walks.id, id));
    return row ? toWalk(row) : null;
  }

  async updateWalk(walk: Walk) {
    const updated = await this.db
      .update(schema.walks)
      .set(walk)
      .where(eq(schema.walks.id, walk.id))
      .returning({ id: schema.walks.id });
    if (updated.length === 0) throw new Error(`walk ${walk.id} not found`);
  }

  async replaceWalkProposals(walkId: string, proposals: WalkProposal[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.walkProposals).where(eq(schema.walkProposals.walkId, walkId));
      if (proposals.length > 0) await tx.insert(schema.walkProposals).values(proposals.map(fromProposal));
    });
  }

  async listWalkProposals(walkId: string) {
    const rows = await this.db
      .select()
      .from(schema.walkProposals)
      .where(eq(schema.walkProposals.walkId, walkId))
      .orderBy(asc(schema.walkProposals.ordinal));
    return rows.map(toProposal);
  }

  async listRecipientProposals(recipientId: string) {
    const rows = await this.db.select().from(schema.walkProposals).where(eq(schema.walkProposals.recipientId, recipientId));
    return rows.map(toProposal);
  }

  async listWalksWithVideo(before: Date) {
    const rows = await this.db
      .select()
      .from(schema.walks)
      .where(and(isNull(schema.walks.videoDeletedAt), lt(schema.walks.createdAt, before)));
    return rows.map(toWalk);
  }

  async updateProposals(proposals: WalkProposal[]) {
    if (proposals.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const p of proposals) {
        const updated = await tx
          .update(schema.walkProposals)
          .set(fromProposal(p))
          .where(eq(schema.walkProposals.id, p.id))
          .returning({ id: schema.walkProposals.id });
        if (updated.length === 0) throw new Error(`proposal ${p.id} not found`);
      }
    });
  }
}
