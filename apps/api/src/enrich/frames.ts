import { execFile } from "node:child_process";
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

/** One JPEG (max 768 px wide) per timestamp. ffmpeg applies the phone's rotation. */
export async function extractFrames(file: string, timesS: number[]): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (const t of timesS) {
    const { stdout } = await run(
      "ffmpeg",
      [
        "-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1",
        "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    );
    if (stdout.length === 0) throw new Error(`ffmpeg produced no frame at ${t.toFixed(2)} s`);
    frames.push(stdout);
  }
  return frames;
}
