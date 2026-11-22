import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Real duration of a video file in seconds, from ffprobe. */
export async function probeDurationS(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    // MediaRecorder WebM often has no duration in its header; count frames instead.
    const { stdout: packets } = await run("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-count_packets",
      "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "csv=p=0", file,
    ]);
    const [rate, count] = packets.trim().split(",");
    const [num, den] = (rate ?? "").split("/").map(Number);
    const fps = num && den ? num / den : NaN;
    const frames = Number(count);
    if (!Number.isFinite(fps) || !Number.isFinite(frames) || fps <= 0 || frames <= 0) {
      throw new Error(`ffprobe couldn't read the video's duration (got "${stdout.trim()}" / "${packets.trim()}")`);
    }
    return frames / fps;
  }
  return duration;
}

/**
 * One JPEG (max 768 px wide) per timestamp, or null where ffmpeg couldn't produce
 * one (a seek past the last frame of a low-frame-rate clip, a damaged stretch).
 * ffmpeg applies the phone's rotation.
 */
export async function extractFrames(file: string, timesS: number[]): Promise<(Buffer | null)[]> {
  const frames: (Buffer | null)[] = [];
  for (const t of timesS) {
    const got = await run(
      "ffmpeg",
      [
        "-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1",
        "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    ).then(
      ({ stdout }) => (stdout.length > 0 ? stdout : null),
      (err: Error) => {
        console.warn(JSON.stringify({ event: "frames.seek_failed", atS: t, message: err.message.slice(0, 200) }));
        return null;
      },
    );
    frames.push(got);
  }
  return frames;
}

/** Where a landmark is in its frame, as fractions of the frame's width and height, from the top-left. */
export type Box = { x: number; y: number; w: number; h: number };

/** The only image Locus keeps from a walk: a crop around the landmark, no wider than this. */
export const CROP_MAX_PX = 480;
/** Room left around the landmark, as a share of its size, so it still reads in context. */
const CROP_MARGIN = 0.15;
/** Without a usable box, the whole frame is kept, but this small. */
const NO_BOX_MAX_PX = 320;

/** The box with margin, clamped to the frame; null when the box isn't usable. */
export function cropRegion(box: Box | null | undefined): Box | null {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 0.03 || box.h < 0.03) return null;
  const x0 = Math.max(0, box.x - box.w * CROP_MARGIN);
  const y0 = Math.max(0, box.y - box.h * CROP_MARGIN);
  const x1 = Math.min(1, box.x + box.w * (1 + CROP_MARGIN));
  const y1 = Math.min(1, box.y + box.h * (1 + CROP_MARGIN));
  if (x1 - x0 < 0.03 || y1 - y0 < 0.03) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Crops a frame to its landmark (privacy: passers-by and number plates elsewhere in
 * the frame are not kept) and shrinks it. Without a usable box, keeps a small whole frame.
 */
export function cropJpeg(jpeg: Buffer, box: Box | null | undefined): Promise<Buffer> {
  const r = cropRegion(box);
  const f = (v: number) => v.toFixed(4);
  const filter = r
    ? `crop=iw*${f(r.w)}:ih*${f(r.h)}:iw*${f(r.x)}:ih*${f(r.y)},scale='min(${CROP_MAX_PX},iw)':-2`
    : `scale='min(${NO_BOX_MAX_PX},iw)':-2`;
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0", "-vf", filter, "-frames:v", "1", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => err.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      const bytes = Buffer.concat(out);
      if (code !== 0 || bytes.length === 0) reject(new Error(`ffmpeg couldn't crop the frame (exit ${code}): ${Buffer.concat(err).toString().trim().slice(0, 200)}`));
      else resolve(bytes);
    });
    ff.stdin.end(jpeg);
  });
}
