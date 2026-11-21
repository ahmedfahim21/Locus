CREATE SCHEMA IF NOT EXISTS "pata";
--> statement-breakpoint
CREATE TABLE "pata"."apiClients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keyHash" text NOT NULL,
	"firstParty" boolean DEFAULT false NOT NULL,
	CONSTRAINT "apiClients_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "pata"."cues" (
	"id" text PRIMARY KEY NOT NULL,
	"homeProfileId" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"landmark" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pata"."homeProfiles" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"location" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography)) STORED,
	"digipin" text NOT NULL,
	"confirmedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "homeProfiles_recipientId_unique" UNIQUE("recipientId")
);
--> statement-breakpoint
CREATE TABLE "pata"."numbers" (
	"did" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pata"."osmFeatures" (
	"osmId" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"altNames" text[] NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"location" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography)) STORED
);
--> statement-breakpoint
CREATE TABLE "pata"."osmWayNodes" (
	"wayId" text NOT NULL,
	"seq" integer NOT NULL,
	"nodeId" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"location" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography)) STORED,
	CONSTRAINT "osmWayNodes_wayId_seq_pk" PRIMARY KEY("wayId","seq")
);
--> statement-breakpoint
CREATE TABLE "pata"."osmWays" (
	"osmId" text PRIMARY KEY NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "pata"."outboundNumbers" (
	"e164" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pata"."recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"authSubject" text,
	"firstName" text NOT NULL,
	"platforms" text[] NOT NULL,
	"expectingDeliveryUntil" timestamp with time zone,
	"fallbackNote" text NOT NULL,
	"phone" text NOT NULL,
	CONSTRAINT "recipients_authSubject_unique" UNIQUE("authSubject")
);
--> statement-breakpoint
CREATE TABLE "pata"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"recipientId" text NOT NULL,
	"callerIdHash" text,
	"state" text NOT NULL,
	"mode" text NOT NULL,
	"language" text NOT NULL,
	"currentCue" integer NOT NULL,
	"lostTurns" integer NOT NULL,
	"screening" jsonb NOT NULL,
	"handoffStartedAt" timestamp with time zone,
	"handoffEndedAt" timestamp with time zone,
	"handoffAnswered" boolean,
	"message" text,
	"createdAt" timestamp with time zone NOT NULL,
	"endedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pata"."turns" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"utterance" text,
	"matchedCueId" text,
	"matchedOsmId" text,
	"instruction" text NOT NULL,
	"lost" boolean NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pata"."cues" ADD CONSTRAINT "cues_homeProfileId_homeProfiles_id_fk" FOREIGN KEY ("homeProfileId") REFERENCES "pata"."homeProfiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."homeProfiles" ADD CONSTRAINT "homeProfiles_recipientId_recipients_id_fk" FOREIGN KEY ("recipientId") REFERENCES "pata"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."numbers" ADD CONSTRAINT "numbers_recipientId_recipients_id_fk" FOREIGN KEY ("recipientId") REFERENCES "pata"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."osmWayNodes" ADD CONSTRAINT "osmWayNodes_wayId_osmWays_osmId_fk" FOREIGN KEY ("wayId") REFERENCES "pata"."osmWays"("osmId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."sessions" ADD CONSTRAINT "sessions_clientId_apiClients_id_fk" FOREIGN KEY ("clientId") REFERENCES "pata"."apiClients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."sessions" ADD CONSTRAINT "sessions_recipientId_recipients_id_fk" FOREIGN KEY ("recipientId") REFERENCES "pata"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pata"."turns" ADD CONSTRAINT "turns_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "pata"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cuesHomeProfileIdx" ON "pata"."cues" USING btree ("homeProfileId");--> statement-breakpoint
CREATE INDEX "osmFeaturesLocationIdx" ON "pata"."osmFeatures" USING gist ("location");--> statement-breakpoint
CREATE INDEX "osmWayNodesLocationIdx" ON "pata"."osmWayNodes" USING gist ("location");--> statement-breakpoint
CREATE INDEX "sessionsRecipientHandoffIdx" ON "pata"."sessions" USING btree ("recipientId","handoffStartedAt");--> statement-breakpoint
CREATE INDEX "turnsSessionIdx" ON "pata"."turns" USING btree ("sessionId");