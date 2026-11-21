import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The shared .env lives at the repository root (Locus/.env).
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in the repository root .env`);
  return v;
}

const config: NextConfig = {
  // Next 16 writes an AGENTS.md by default; this repo keeps one markdown file per project.
  agentRules: false,
  // Only public values reach the browser. Never expose SUPABASE_SECRET_KEY here.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: required("SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required("SUPABASE_PUBLISHABLE_KEY"),
    NEXT_PUBLIC_LOCUS_API_URL: required("LOCUS_API_URL"),
  },
};

export default config;
