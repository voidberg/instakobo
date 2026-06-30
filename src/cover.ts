/**
 * Best-effort page metadata lookup. Instapaper does not surface cover or author,
 * so we try to read them straight from the page's `<head>` - the Open Graph /
 * Twitter image tag and the author/byline metadata - on a single fetch.
 */
export interface PageMetadata {
  /** Absolute URL of the lead/cover image, if the page advertises one. */
  image?: string;
  /** The article's byline, if discoverable from page metadata. */
  author?: string;
}

export async function fetchPageMetadata(
  url: string,
  timeoutMs = 8000,
): Promise<PageMetadata> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; instakobo)" },
    });
    clearTimeout(timer);
    if (!res.ok) return {};

    // Only the <head> is needed; avoid buffering huge pages.
    const html = (await res.text()).slice(0, 200_000);
    const rawImage = extractMetaImage(html);
    return {
      image: rawImage ? new URL(rawImage, res.url).toString() : undefined,
      author: extractMetaAuthor(html),
    };
  } catch {
    return {};
  }
}

export function extractMetaImage(html: string): string | undefined {
  return metaContent(html, [
    "og:image:secure_url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
  ]);
}

/**
 * Pulls a human byline from page metadata, preferring the most reliable sources:
 * the canonical `author` meta, then schema.org JSON-LD, then the Open Graph
 * `article:author` (often a profile URL, so URL values are rejected), then the
 * Twitter handle as a last resort. Returns undefined when nothing usable exists.
 */
export function extractMetaAuthor(html: string): string | undefined {
  const candidates = [
    metaContent(html, ["author", "parsely-author"]),
    authorFromJsonLd(html),
    metaContent(html, ["article:author"]),
    metaContent(html, ["twitter:creator"]),
  ];
  for (const candidate of candidates) {
    const cleaned = candidate && cleanName(candidate);
    if (cleaned) return cleaned;
  }
  return undefined;
}

/** Reads the `content` of the first matching `<meta property|name="...">` tag. */
function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return content;
  }
  return undefined;
}

/**
 * Extracts an author name from schema.org JSON-LD, covering the common forms:
 * `"author":"Name"`, `"author":{...,"name":"Name"}`, and
 * `"author":[{"name":"Name"},...]`.
 */
function authorFromJsonLd(html: string): string | undefined {
  const m = html.match(
    /"author"\s*:\s*(?:"(?<str>[^"]+)"|\{[^}]*?"name"\s*:\s*"(?<obj>[^"]+)"|\[\s*\{[^}]*?"name"\s*:\s*"(?<arr>[^"]+)")/i,
  );
  const name = m?.groups?.str ?? m?.groups?.obj ?? m?.groups?.arr;
  if (!name) return undefined;
  // Undo JSON string escapes (\uXXXX, \", \/) that survive in minified JSON-LD.
  return name
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");
}

function cleanName(value: string): string | undefined {
  const decoded = decodeEntities(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@/, "");
  if (!decoded || looksLikeUrl(decoded) || decoded.length > 120) {
    return undefined;
  }
  return decoded;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
