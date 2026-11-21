ALTER SCHEMA "pata" RENAME TO "locus";
--> statement-breakpoint
UPDATE "locus"."apiClients"
SET "name" = 'locus-worker'
WHERE "name" = 'pata-worker' AND "firstParty";
