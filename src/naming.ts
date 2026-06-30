import { join } from "@std/path";
import type { Article, Folder } from "./instapaper.ts";

/**
 * Builds a filesystem-safe slug from an article title. Strips emoji and
 * punctuation, collapses whitespace to single hyphens, and lowercases.
 */
export function slugify(title: string): string {
  return title
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[|\\/'’,<>:|?"*]/g, "")
    .replace(/\s\s+/g, " ")
    .trim()
    .replace(/\s/g, "-")
    .toLowerCase();
}

/** Output directory for an article. */
export function outputDirectory(base: string, folder?: Folder): string {
  return folder ? join(base, folder.title) : base;
}

/**
 * Filename for an article, with `ipaper`, the optional folder and the
 * bookmark id so {@link parseArticleId} on the device can recover them:
 * `my-article-ipaper[-folder]-1234[.kepub].epub`.
 */
export function outputFile(article: Article, kepub: boolean): string {
  const parts = [slugify(article.title), "ipaper"];
  if (article.folder) parts.push(article.folder.title);
  parts.push(String(article.id));
  return `${parts.join("-")}${kepub ? ".kepub" : ""}.epub`;
}

/** Full disk path for an article's epub file. */
export function outputPath(
  base: string,
  article: Article,
  kepub: boolean,
): string {
  return join(
    outputDirectory(base, article.folder),
    outputFile(article, kepub),
  );
}
