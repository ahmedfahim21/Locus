import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The shared .env lives at the repository root (Locus/.env). */
const ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/** Reads a required environment variable. Throws naming the variable; never falls back. */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing environment variable ${name} (set it in the repository root .env)`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}
