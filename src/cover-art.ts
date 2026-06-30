/**
 * Cover generator for articles. "Book like" images are used as is, landscape images
 * are composited with the title and the author / source and if there is no cover image
 * we generate a cover with the title and the author / source.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { encodeBase64 } from "@std/encoding/base64";
import { type CoverTransform, imageSize, type RawImage } from "@voidberg/quarto";

const WIDTH = 1200;
const HEIGHT = 1920;
// Uniform padding around the image, title and source.
const MARGIN = 96;
// height/width at or above which a source image is treated as already cover-shaped.
const PORTRAIT_RATIO = 1.3;

/** Composed-cover background; also passed to quarto so the cover page's
 * letterbox bands match (no mismatched white strips on e-readers). */
export const COVER_BACKGROUND = "#f4f1ea";
const BG = COVER_BACKGROUND;
const INK = "#1a1a1a";
const MUTED = "#8a7f6a";

let assets: Promise<Uint8Array[]> | undefined;

/** Initialise resvg once and return the font buffers. */
function ensureResvg(): Promise<Uint8Array[]> {
  if (!assets) {
    assets = (async () => {
      await initWasm(
        await Deno.readFile(new URL("./assets/resvg.wasm", import.meta.url)),
      );
      return [
        await Deno.readFile(
          new URL("./assets/literata-400.ttf", import.meta.url),
        ),
        await Deno.readFile(
          new URL("./assets/literata-700.ttf", import.meta.url),
        ),
      ];
    })();
  }
  return assets;
}

/**
 * A quarto cover transform that makes Instapaper articles look like books.
 *
 * Portrait / cover-shaped source images are used as-is (they're already proper
 * covers - adding a title would just duplicate it). Landscape images, or articles
 * with no image at all, get a composed portrait cover: the image fills the top,
 * with the article title and source rendered below on a clean background. The
 * output is always a normal portrait raster, so it renders correctly as both the
 * shelf thumbnail and the in-book cover on every reader.
 *
 * @param source the article's domain, shown as the subtitle (e.g. "vtdigger.org").
 */
export function coverArtist(source: string): CoverTransform {
  return async (cover, meta) => {
    if (cover) {
      const dims = imageSize(cover.data, cover.mime);
      if (dims && dims.height / dims.width >= PORTRAIT_RATIO) return cover;
    }

    const fonts = await ensureResvg();
    const svg = composeSvg(cover, meta.title, source);
    const png = new Resvg(svg, {
      font: { fontBuffers: fonts, defaultFontFamily: "Literata" },
    })
      .render()
      .asPng();

    return { data: new Uint8Array(png), mime: "image/png" };
  };
}

function composeSvg(
  image: RawImage | null,
  title: string,
  source: string,
): string {
  const headline = stripSourceSuffix(title, source);
  // Scale the title down for long headlines so it stays within the cover.
  const fontSize = headline.length > 110 ? 54 : headline.length > 70 ? 64 : 78;
  const lineHeight = Math.round(fontSize * 1.25);
  const charsPerLine = Math.max(
    10,
    Math.floor((WIDTH - 2 * MARGIN) / (fontSize * 0.52)),
  );
  const lines = wrap(headline, charsPerLine);

  const parts: string[] = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>`,
  ];

  let titleBaseline: number;
  if (image) {
    const bandHeight = 1000;
    parts.push(
      `<image x="${MARGIN}" y="${MARGIN}" width="${
        WIDTH - 2 * MARGIN
      }" height="${bandHeight}" href="${dataUri(image)}" preserveAspectRatio="xMidYMid slice"/>`,
    );
    titleBaseline = MARGIN + bandHeight + MARGIN + fontSize;
  } else {
    titleBaseline = Math.round((HEIGHT - lines.length * lineHeight) / 2) + fontSize;
  }

  lines.forEach((line, i) => {
    parts.push(
      `<text x="${WIDTH / 2}" y="${
        titleBaseline + i * lineHeight
      }" font-family="Literata" font-weight="700" font-size="${fontSize}" text-anchor="middle" fill="${INK}">${
        esc(
          line,
        )
      }</text>`,
    );
  });

  if (source) {
    parts.push(
      `<text x="${WIDTH / 2}" y="${
        HEIGHT - MARGIN
      }" font-family="Literata" font-size="40" text-anchor="middle" fill="${MUTED}" letter-spacing="3">${
        esc(
          source.toUpperCase(),
        )
      }</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${
    parts.join(
      "",
    )
  }</svg>`;
}

// Real title/suffix separators as they appear in article titles. The em/en
// dashes here are data we match against, not prose - leave them as-is.
const TITLE_SEPARATORS = [" - ", " — ", " – ", " | ", " · ", " :: "];

/**
 * Drop a trailing " - Site" suffix from a headline when it matches the source
 * (e.g. "...ruling on child sexual abuse - VTDigger" with source "vtdigger.org").
 * Only strips when the suffix matches the domain, so real subtitles/authors
 * ("Shoes Outside the Door - Michael Downing") are left intact.
 */
export function stripSourceSuffix(title: string, source: string): string {
  if (!source) return title;

  const labels = source.split(".");
  const site = labels.length >= 2 ? labels[labels.length - 2]! : source;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(site);
  if (!target) return title;

  for (const sep of TITLE_SEPARATORS) {
    const idx = title.lastIndexOf(sep);
    if (idx <= 0) continue;

    const suffix = norm(title.slice(idx + sep.length));
    if (suffix && (suffix === target || suffix.includes(target))) {
      const stripped = title.slice(0, idx).trimEnd();
      if (stripped) return stripped;
    }
  }

  return title;
}

/** The bare domain of a URL (no leading `www.`), for use as a cover subtitle. */
export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dataUri(image: RawImage): string {
  return `data:${image.mime};base64,${encodeBase64(image.data)}`;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current && `${current} ${word}`.length > max) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
