/**
 * Copies stored files (walk videos, landmark frames) from one Supabase project's
 * bucket to another's, for moving Locus to a new project. Reads the old project's
 * settings from an env file and the new one's from the current environment.
 *
 *   pnpm --filter @locus/api copy:storage <old-env-file> <path> [<path> ...]
 *
 * Paths are object names in the bucket (from `select name from storage.objects`).
 * Fails on the first file that doesn't copy; already-copied files are overwritten.
 */
import { readFileSync } from "node:fs";
import { env } from "../config.js";
import { WALK_BUCKET } from "../storage/storage.js";
import { SupabaseStorage } from "../storage/supabaseStorage.js";

function readEnvFile(file: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return vars;
}

const [oldEnvFile, ...paths] = process.argv.slice(2);
if (!oldEnvFile || paths.length === 0) throw new Error("Usage: copy:storage <old-env-file> <path> [<path> ...]");
const old = readEnvFile(oldEnvFile);
const bucket = WALK_BUCKET;
/** Every file Locus stores is one of these (see VIDEO_TYPES and landmark frames). */
const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", webm: "video/webm", mp4: "video/mp4", mov: "video/quicktime" };
for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) if (!old[key]) throw new Error(`${oldEnvFile} has no ${key}`);
if (old.SUPABASE_URL === env("SUPABASE_URL")) throw new Error("Old and new SUPABASE_URL are the same project");

const from = new SupabaseStorage(old.SUPABASE_URL!, old.SUPABASE_SECRET_KEY!, bucket);
const to = new SupabaseStorage(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), bucket);
await to.ensureBucket();
for (const path of paths) {
  const contentType = CONTENT_TYPES[path.split(".").pop()!.toLowerCase()];
  if (!contentType) throw new Error(`Don't know the content type of ${path}`);
  const bytes = await from.download(path);
  await to.upload(path, bytes, contentType);
  console.log(`copied ${path} (${bytes.length} bytes, ${contentType})`);
}
console.log(`Copied ${paths.length} file(s) to bucket ${bucket}.`);
