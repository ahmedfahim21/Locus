/** Longest side after shrinking: enough to read a shop board, small enough to upload fast. */
const MAX_SIDE = 1600;
export const MAX_PHOTOS = 8;

/**
 * Any photo or screenshot the browser can open, as a JPEG at most 1600 px on
 * its longest side. Throws, naming the file, if the browser can't read it.
 */
export async function toJpeg(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`This browser can't open "${file.name}". Try a JPEG or PNG, or a screenshot.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos for upload.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error(`Couldn't convert "${file.name}" to JPEG.`);
  return blob;
}
