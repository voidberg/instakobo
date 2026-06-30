import { assertEquals } from "@std/assert";
import { extractMetaAuthor, extractMetaImage } from "./cover.ts";

Deno.test("extractMetaImage reads og:image", () => {
  const html = `<head><meta property="og:image" content="https://x/cover.jpg"></head>`;
  assertEquals(extractMetaImage(html), "https://x/cover.jpg");
});

Deno.test("extractMetaImage falls back to twitter:image", () => {
  const html = `<head><meta name="twitter:image" content="https://x/t.png"/></head>`;
  assertEquals(extractMetaImage(html), "https://x/t.png");
});

Deno.test("extractMetaImage prefers og:image over twitter:image", () => {
  const html = `
    <meta name="twitter:image" content="https://x/t.png">
    <meta property="og:image" content="https://x/og.jpg">`;
  assertEquals(extractMetaImage(html), "https://x/og.jpg");
});

Deno.test("extractMetaImage returns undefined when absent", () => {
  assertEquals(extractMetaImage("<head><title>No image</title></head>"), undefined);
});

Deno.test("extractMetaAuthor reads the author meta tag", () => {
  const html = `<meta name="author" content="Jane Doe">`;
  assertEquals(extractMetaAuthor(html), "Jane Doe");
});

Deno.test("extractMetaAuthor decodes HTML entities", () => {
  const html = `<meta name="author" content="Conor O&#39;Brien &amp; Co.">`;
  assertEquals(extractMetaAuthor(html), "Conor O'Brien & Co.");
});

Deno.test("extractMetaAuthor reads JSON-LD author object", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Article","author":{"@type":"Person","name":"Ada Lovelace"}}</script>`;
  assertEquals(extractMetaAuthor(html), "Ada Lovelace");
});

Deno.test("extractMetaAuthor reads JSON-LD author array", () => {
  const html = `{"author":[{"@type":"Person","name":"First Writer"},{"name":"Second"}]}`;
  assertEquals(extractMetaAuthor(html), "First Writer");
});

Deno.test("extractMetaAuthor reads JSON-LD author string", () => {
  const html = `{"author":"Plain String Author"}`;
  assertEquals(extractMetaAuthor(html), "Plain String Author");
});

Deno.test("extractMetaAuthor unescapes JSON-LD unicode escapes", () => {
  const html = `{"author":{"name":"Jos\\u00e9 Garc\\u00eda"}}`;
  assertEquals(extractMetaAuthor(html), "José García");
});

Deno.test("extractMetaAuthor prefers author meta over article:author", () => {
  const html = `
    <meta property="article:author" content="https://facebook.com/profile">
    <meta name="author" content="Real Name">`;
  assertEquals(extractMetaAuthor(html), "Real Name");
});

Deno.test("extractMetaAuthor rejects URL-only article:author", () => {
  const html = `<meta property="article:author" content="https://example.com/u/123">`;
  assertEquals(extractMetaAuthor(html), undefined);
});

Deno.test("extractMetaAuthor strips a leading @ from twitter:creator", () => {
  const html = `<meta name="twitter:creator" content="@reporter">`;
  assertEquals(extractMetaAuthor(html), "reporter");
});

Deno.test("extractMetaAuthor returns undefined when absent", () => {
  assertEquals(extractMetaAuthor("<head><title>No byline</title></head>"), undefined);
});
