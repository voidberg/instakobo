import { assertEquals } from "@std/assert";
import type { Article } from "./instapaper.ts";
import { outputFile, outputPath, slugify } from "./naming.ts";

const article = (over: Partial<Article> = {}): Article => ({
  id: 1234,
  url: "https://example.com",
  title: "My Great Article",
  author: "Instapaper",
  ...over,
});

Deno.test("slugify strips punctuation, emoji and whitespace", () => {
  assertEquals(slugify("My Great Article"), "my-great-article");
  assertEquals(slugify("Hello, World! 🎉"), "hello-world!");
  assertEquals(slugify('A "Quoted" / Path: Title'), "a-quoted-path-title");
});

Deno.test("outputFile encodes ipaper, folder and id", () => {
  assertEquals(outputFile(article(), true), "my-great-article-ipaper-1234.kepub.epub");
  assertEquals(outputFile(article(), false), "my-great-article-ipaper-1234.epub");
  assertEquals(
    outputFile(article({ folder: { id: 9, title: "News", slug: "news" } }), true),
    "my-great-article-ipaper-News-1234.kepub.epub",
  );
});

// The device-side parser in kobo.ts recovers id/folder from the filename by
// splitting on "-"; verify that round-trip holds for the names we generate.
Deno.test("generated filename round-trips back to id and folder", () => {
  for (const folder of [undefined, { id: 9, title: "News", slug: "news" }]) {
    const name = outputFile(article({ folder }), true);
    const parts = name.replace(".kepub.epub", "").split("-");
    const id = Number.parseInt(parts[parts.length - 1]!, 10);
    const maybeFolder = parts[parts.length - 2];
    assertEquals(id, 1234);
    assertEquals(maybeFolder !== "ipaper" ? maybeFolder : undefined, folder?.title);
  }
});

Deno.test("outputPath nests foldered articles in a subdirectory", () => {
  assertEquals(
    outputPath("/out", article({ folder: { id: 9, title: "News", slug: "news" } }), true),
    "/out/News/my-great-article-ipaper-News-1234.kepub.epub",
  );
  assertEquals(outputPath("/out", article(), true), "/out/my-great-article-ipaper-1234.kepub.epub");
});
