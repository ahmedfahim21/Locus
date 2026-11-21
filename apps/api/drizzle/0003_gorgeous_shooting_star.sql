CREATE TABLE "locus"."walkProposals" (
	"id" text PRIMARY KEY NOT NULL,
	"walkId" text NOT NULL,
	"recipientId" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"nameHi" text,
	"nameKn" text,
	"aliases" text[] NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"osmId" text,
	"framePath" text,
	"atS" double precision NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locus"."walks" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"videoPath" text NOT NULL,
	"contentType" text NOT NULL,
	"durationS" double precision NOT NULL,
	"track" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"createdAt" timestamp with time zone NOT NULL,
	"processedAt" timestamp with time zone,
	"videoDeletedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "locus"."cues" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "locus"."cues" ADD COLUMN "source" text DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "locus"."cues" ADD COLUMN "photoPath" text;--> statement-breakpoint
ALTER TABLE "locus"."walkProposals" ADD CONSTRAINT "walkProposals_walkId_walks_id_fk" FOREIGN KEY ("walkId") REFERENCES "locus"."walks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locus"."walkProposals" ADD CONSTRAINT "walkProposals_recipientId_recipients_id_fk" FOREIGN KEY ("recipientId") REFERENCES "locus"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locus"."walks" ADD CONSTRAINT "walks_recipientId_recipients_id_fk" FOREIGN KEY ("recipientId") REFERENCES "locus"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "walkProposalsWalkIdx" ON "locus"."walkProposals" USING btree ("walkId");--> statement-breakpoint
CREATE INDEX "walkProposalsRecipientIdx" ON "locus"."walkProposals" USING btree ("recipientId");--> statement-breakpoint
CREATE INDEX "walksRecipientIdx" ON "locus"."walks" USING btree ("recipientId");