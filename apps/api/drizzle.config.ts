import { defineConfig } from "drizzle-kit";
import { optionalEnv } from "./src/config.js";

// `generate` needs no database; `migrate` fails loudly if DATABASE_URL is missing.
const url = optionalEnv("DATABASE_URL");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["locus"],
  migrations: { schema: "locus_migrations", table: "__drizzle_migrations" },
  ...(url ? { dbCredentials: { url } } : {}),
});
