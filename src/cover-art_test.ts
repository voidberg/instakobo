import { assertEquals } from "@std/assert";
import { sourceDomain, stripSourceSuffix } from "./cover-art.ts";

Deno.test("sourceDomain strips protocol and www", () => {
  assertEquals(sourceDomain("https://www.vtdigger.org/a/b"), "vtdigger.org");
  assertEquals(sourceDomain("https://thewalrus.ca/x"), "thewalrus.ca");
  assertEquals(sourceDomain("not a url"), "");
});

Deno.test("stripSourceSuffix removes a trailing site name that matches the domain", () => {
  assertEquals(stripSourceSuffix("A headline - VTDigger", "vtdigger.org"), "A headline");
  assertEquals(stripSourceSuffix("A headline | The Walrus", "thewalrus.ca"), "A headline");
  assertEquals(stripSourceSuffix("A headline — VTDigger Media", "vtdigger.org"), "A headline");
});

Deno.test("stripSourceSuffix keeps unrelated trailing segments", () => {
  assertEquals(
    stripSourceSuffix("Shoes Outside the Door - Michael Downing", "counterpoint.com"),
    "Shoes Outside the Door - Michael Downing",
  );
  assertEquals(stripSourceSuffix("A plain headline", "vtdigger.org"), "A plain headline");
  assertEquals(stripSourceSuffix("Anything", ""), "Anything");
});
