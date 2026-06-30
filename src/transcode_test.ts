import { encode as encodeAvif } from "@jsquash/avif";
import { encode as encodeWebp } from "@jsquash/webp";
import { assert, assertEquals } from "@std/assert";
import { transcodeForKobo } from "./transcode.ts";

Deno.test("transcodeForKobo passes non-WebP/AVIF images through unchanged", async () => {
  const data = new Uint8Array([1, 2, 3, 4]);

  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/svg+xml"]) {
    const out = await transcodeForKobo({ data, mime });
    assertEquals(out, { data, mime });
  }
});

Deno.test("transcodeForKobo ignores parameters on the MIME type", async () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const out = await transcodeForKobo({ data, mime: "image/png; charset=binary" });
  assertEquals(out, { data, mime: "image/png; charset=binary" });
});

Deno.test("transcodeForKobo converts WebP and AVIF to a Kobo-safe type", async () => {
  // A tiny opaque image to round-trip through each source codec.
  const w = 4;
  const h = 4;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 200;
    pixels[i + 1] = 100;
    pixels[i + 2] = 50;
    pixels[i + 3] = 255;
  }
  const image = { data: pixels, width: w, height: h, colorSpace: "srgb" } as ImageData;

  for (
    const [mime, encode] of [
      ["image/webp", encodeWebp],
      ["image/avif", encodeAvif],
    ] as const
  ) {
    const source = new Uint8Array(await encode(image));
    const out = await transcodeForKobo({ data: source, mime });

    assert(out !== null, `${mime} should transcode, not drop`);
    assert(
      out.mime === "image/png" || out.mime === "image/jpeg",
      `${mime} → ${out.mime} should be a Kobo-safe type`,
    );
    assert(out.data.length > 0, `${mime} output should have bytes`);
  }
});
