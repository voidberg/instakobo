import { decode as decodeAvif } from "@jsquash/avif";
import { encode as encodeJpeg } from "@jsquash/jpeg";
import { encode as encodePng } from "@jsquash/png";
import { decode as decodeWebp } from "@jsquash/webp";
import type { ImageTransform } from "@voidberg/quarto";

/**
 * Decoders for image types Kobo can't render but the web commonly serves. Kobo
 * handles JPEG/PNG/GIF but not WebP or AVIF - even though both are valid EPUB3
 * core types (Apple Books renders them fine), so without transcoding those
 * images show the "missing image" placeholder on the device.
 */
const DECODERS: Record<string, (buffer: ArrayBuffer) => Promise<ImageData | null>> = {
  "image/webp": decodeWebp,
  "image/avif": decodeAvif,
};

/**
 * Image transform for quarto that makes covers and inline images Kobo-renderable.
 *
 * WebP/AVIF are decoded, then re-encoded as both PNG and JPEG, keeping whichever
 * is smaller: flat UI/screenshots compress best (and stay crisp) as PNG, while
 * photos shrink dramatically as JPEG - avoiding the size blow-up a PNG-only path
 * causes. Any other type (incl. ones we can't decode) passes through untouched;
 * quarto then drops it if EPUB can't carry it without a fallback.
 */
export const transcodeForKobo: ImageTransform = async ({ data, mime }) => {
  const decode = DECODERS[normalize(mime)];
  if (!decode) {
    return { data, mime };
  }

  const imageData = await decode(toArrayBuffer(data));
  // Decode failed: leave the original bytes so quarto drops the unsupported type.
  if (!imageData) {
    return { data, mime };
  }

  const [png, jpeg] = await Promise.all([
    encodePng(imageData).then((b) => new Uint8Array(b)),
    encodeJpeg(imageData, { quality: 85 }).then((b) => new Uint8Array(b)),
  ]);

  return jpeg.length < png.length
    ? { data: jpeg, mime: "image/jpeg" }
    : { data: png, mime: "image/png" };
};

function normalize(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/** A tight ArrayBuffer over the bytes, copying only when the view is offset. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer;
}
