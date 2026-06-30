import { parseArgs } from "@std/cli/parse-args";
import { InstapaperAuthError, InstapaperClient } from "./instapaper.ts";
import {
  getArticles,
  getHighlights,
  type KoboArticle,
  KoboDatabase,
  koboDbPath,
  removeKoboArticle,
  removeLocalArticle,
} from "./kobo.ts";
import { log, Spinner } from "./log.ts";
import { connect } from "./setup.ts";

export async function sync(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: [
      "instapaper-key",
      "instapaper-secret",
      "instapaper-token",
      "instapaper-token-secret",
      "instapaper-user",
      "instapaper-pass",
      "kobo-dir",
      "out-dir",
    ],
    boolean: ["archive", "delete", "help"],
    alias: { h: "help", o: "out-dir" },
    default: {
      archive: false,
      delete: false,
      "kobo-dir": "/Volumes/KOBOeReader/",
      "out-dir": "",
    },
  });

  if (flags.help) {
    printHelp();
    return 0;
  }

  const client = await connect(flags);
  const koboDir = flags["kobo-dir"];
  const outDir = flags["out-dir"];

  const dbPath = koboDbPath(koboDir);
  let db: KoboDatabase;
  try {
    db = KoboDatabase.open(dbPath);
  } catch (err) {
    log.error(
      `Unable to open the Kobo database at ${dbPath}: ${errorMessage(err)}`,
    );
    log.info("Is the device mounted? Override the path with --kobo-dir.");
    return 1;
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  try {
    const articles = getArticles(db);
    log.heading(`Scanning ${articles.length} article(s) on the Kobo.`);

    for (const article of articles) {
      try {
        const acted = await syncArticle(client, db, article, {
          koboDir,
          outDir,
          archive: flags.archive,
          delete: flags.delete,
        });
        if (acted) updated++;
        else unchanged++;
      } catch (err) {
        // A rejected token won't recover article-to-article - abort the whole run.
        if (err instanceof InstapaperAuthError) throw err;
        failed++;
        log.error(`Failed to sync "${article.title}": ${errorMessage(err)}`);
      }
    }
  } finally {
    db.close();
  }

  log.heading(
    `Done - ${updated} updated, ${unchanged} unchanged, ${failed} failed.`,
  );
  return failed > 0 ? 1 : 0;
}

interface SyncOptions {
  koboDir: string;
  outDir: string;
  /** Archive finished articles on Instapaper (off by default - alters account data). */
  archive: boolean;
  /** Remove finished articles from the device and output dir (off by default). */
  delete: boolean;
}

/** Syncs one article; returns true if it had anything to push, false if skipped. */
async function syncArticle(
  client: InstapaperClient,
  db: KoboDatabase,
  article: KoboArticle,
  opts: SyncOptions,
): Promise<boolean> {
  const highlights = getHighlights(db, article.koboId);
  const hasProgress = article.progressTimestamp !== undefined && article.progress > 0;

  // Nothing to push (unopened, no progress, no highlights) - stay quiet so a
  // scan of hundreds of articles only surfaces the ones we actually touch.
  if (!hasProgress && highlights.length === 0) return false;

  log.heading(`${article.title}  (#${article.id})`);
  const facts: string[] = [];
  if (article.folder) facts.push(`folder: ${article.folder}`);
  facts.push(`progress: ${Math.round(article.progress * 100)}%`);
  if (article.progressTimestamp) {
    facts.push(`last read: ${formatDate(article.progressTimestamp)}`);
  }
  log.info(facts.join("  ·  "));

  if (article.progressTimestamp && article.progress > 0) {
    await client.updateProgress(
      article.id,
      article.progress,
      article.progressTimestamp,
    );
    log.success(
      `Updated reading progress to ${Math.round(article.progress * 100)}%.`,
    );
  }

  if (highlights.length > 0) {
    const spinner = new Spinner(
      `Syncing ${highlights.length} highlight(s)`,
    ).start();
    const existing = new Set(
      (await client.getHighlights(article.id)).map((h) => h.text),
    );
    let created = 0;
    let skipped = 0;
    for (const text of highlights) {
      if (existing.has(text)) {
        skipped++;
      } else {
        await client.addHighlight(article.id, text);
        created++;
      }
    }
    spinner.succeed(
      `Highlights: ${created} created, ${skipped} already present.`,
    );
  }

  if (article.progress >= 1) {
    if (opts.archive) {
      await client.archive(article.id);
      log.success("Archived on Instapaper.");
    }

    if (opts.delete) {
      tryRemove(
        () => removeKoboArticle(article.koboId, opts.koboDir),
        "the Kobo device",
      );
      if (opts.outDir) {
        tryRemove(
          () => removeLocalArticle(opts.outDir, article),
          "the local output directory",
        );
      }
    }
  }

  return true;
}

function tryRemove(fn: () => void, where: string): void {
  try {
    fn();
    log.step(`Removed from ${where}.`);
  } catch {
    log.warn(`Could not remove from ${where} (already gone?).`);
  }
}

function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${
    pad(
      d.getMinutes(),
    )
  }`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printHelp(): void {
  console.log(`instakobo sync - push reading progress and highlights back to Instapaper

By default sync is non-destructive: it updates reading progress and uploads
highlights only. Add --archive and/or --delete to act on finished articles.

USAGE:
  instakobo sync [options]

OPTIONS:
      --kobo-dir <dir>      Mounted Kobo path (default: /Volumes/KOBOeReader/)
  -o, --out-dir <dir>       (K)EPUB dir; finished files are removed here too (with --delete)
      --archive             Also archive finished articles on Instapaper
      --delete              Also delete finished articles from the device (and --out-dir)
  -h, --help                Show this help

CREDENTIALS:
  Run "instakobo setup" once to save them. To override, set environment
  variables (INSTAPAPER_KEY/SECRET plus INSTAPAPER_TOKEN/TOKEN_SECRET, or
  INSTAPAPER_USERNAME/PASSWORD) or pass the matching --instapaper-* flags.`);
}
