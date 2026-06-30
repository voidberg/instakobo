import { assertAlmostEquals, assertEquals } from "@std/assert";
import { getArticles, KoboDatabase } from "./kobo.ts";

// A real Kobo database captured from a device, kept alongside the original
// instakobo source. Skipped automatically if it isn't present.
const FIXTURE = new URL("../../instakobo/KoboReader2.sqlite", import.meta.url).pathname;

function hasFixture(): boolean {
  try {
    Deno.statSync(FIXTURE);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "getArticles parses real Instapaper rows from a Kobo database",
  ignore: !hasFixture(),
  fn: () => {
    const db = KoboDatabase.open(FIXTURE);
    try {
      const articles = getArticles(db);
      assertEquals(articles.length, 5);

      const byId = new Map(articles.map((a) => [a.id, a]));
      const hiker = byId.get(1409831053);
      assertEquals(hiker?.title, "A Nameless Hiker and the Case the Internet Can’t Crack");
      assertEquals(hiker?.folder, "Articles");
      assertEquals(hiker?.progress, 1);
      // 2021-07-29T00:15:00Z
      assertAlmostEquals(hiker?.progressTimestamp ?? 0, 1627517700, 1);

      // Every article recovered a numeric bookmark id and a filename.
      for (const a of articles) {
        assertEquals(Number.isNaN(a.id), false);
        assertEquals(a.fileName.endsWith(".kepub.epub"), true);
      }
    } finally {
      db.close();
    }
  },
});
