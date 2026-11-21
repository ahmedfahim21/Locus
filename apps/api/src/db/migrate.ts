import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../config.js";

const client = postgres(env("DATABASE_URL"), { max: 1 });
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

try {
  // Serialize journal relocation and the subsequent Drizzle migration.
  await client`SELECT pg_advisory_lock(hashtext('locus-db-migrate'))`;
  await client`
    DO $$
    BEGIN
      IF to_regclass('pata."pataMigrations"') IS NOT NULL THEN
        CREATE SCHEMA IF NOT EXISTS "locus_migrations";
        IF to_regclass('locus_migrations.__drizzle_migrations') IS NOT NULL THEN
          RAISE EXCEPTION 'Both the legacy and Locus migration journals exist. Reconcile them before migrating.';
        END IF;

        ALTER TABLE "pata"."pataMigrations" SET SCHEMA "locus_migrations";
        ALTER TABLE "locus_migrations"."pataMigrations" RENAME TO "__drizzle_migrations";
        ALTER INDEX IF EXISTS "locus_migrations"."pataMigrations_pkey" RENAME TO "__drizzle_migrations_pkey";
        ALTER SEQUENCE IF EXISTS "locus_migrations"."pataMigrations_id_seq" RENAME TO "__drizzle_migrations_id_seq";
      END IF;
    END $$;
  `;
  await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "locus_migrations" });
  console.log("Locus database migrations applied.");
} finally {
  await client.end();
}
