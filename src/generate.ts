import { parseArgs } from "@std/cli/parse-args";
import { ProgressBar } from "@std/cli/unstable-progress-bar";
import { ensureDir, exists } from "@std/fs";
import { generateEpub, toKepub } from "@voidberg/quarto";
import { fetchPageMetadata } from "./cover.ts";
import {
  type Article,
  type Folder,
  InstapaperAuthError,
  InstapaperClient,
  InstapaperContentError,
} from "./instapaper.ts";
import { connect } from "./setup.ts";
import { log } from "./log.ts";
import { outputDirectory, outputPath } from "./naming.ts";
import { COVER_BACKGROUND, coverArtist, sourceDomain } from "./cover-art.ts";
import { transcodeForKobo } from "./transcode.ts";

interface Tally {
  saved: number;
  skipped: number;
  /** Articles Instapaper couldn't extract text for (skipped, not a failure). */
  unsupported: number;
  failed: number;
}

export async function generate(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: [
      "instapaper-key",
      "instapaper-secret",
      "instapaper-token",
      "instapaper-token-secret",
      "instapaper-user",
      "instapaper-pass",
      "out-dir",
      "limit",
    ],
    boolean: ["skip-kepub", "skip-meta", "force", "help"],
    alias: { h: "help", o: "out-dir" },
    default: {
      "out-dir": "./kepub",
      "skip-kepub": false,
      "skip-meta": false,
      force: false,
      limit: "500",
    },
  });

  if (flags.help) {
    printHelp();
    return 0;
  }

  const client = await connect(flags);
  const outDir = flags["out-dir"];
  const kepub = !flags["skip-kepub"];
  const fetchMeta = !flags["skip-meta"];
  const limit = Number.parseInt(flags.limit, 10) || 500;

  await ensureDir(outDir);

  log.heading("Fetching folders");
  const folders = await client.getFolders();
  log.success(`Found ${folders.length} folder(s).`);

  const tally: Tally = { saved: 0, skipped: 0, unsupported: 0, failed: 0 };
  for (const folder of [undefined, ...folders]) {
    await processFolder(client, outDir, kepub, fetchMeta, limit, flags.force, tally, folder);
  }

  log.heading(
    `Done - ${tally.saved} saved, ${tally.skipped} skipped, ${tally.unsupported} unsupported (no text), ${tally.failed} failed.`,
  );
  return tally.failed > 0 ? 1 : 0;
}

async function processFolder(
  client: InstapaperClient,
  outDir: string,
  kepub: boolean,
  fetchMeta: boolean,
  limit: number,
  force: boolean,
  tally: Tally,
  folder?: Folder,
): Promise<void> {
  log.heading(folder ? `Folder: ${folder.title}` : "Unfiled articles");
  const articles = await client.getArticles(folder, limit);
  await ensureDir(outputDirectory(outDir, folder));
  log.info(`${articles.length} article(s).`);
  if (articles.length === 0) return;

  // Group articles into a Kobo collection (via series metadata), preserving
  // Instapaper's order as the series index. Unfiled articles go under
  // "Instapaper"; foldered ones under "Instapaper - <folder>". Stock firmware
  // ignores this; the NickelSeries mod acts on it.
  const series = folder ? `Instapaper - ${folder.title}` : "Instapaper";

  const progress = new FolderProgress(articles.length);
  let index = 0;
  for (const article of articles) {
    index++;
    progress.track(article.title);
    const path = outputPath(outDir, article, kepub);

    if (!force && (await exists(path))) {
      tally.skipped++;
      progress.skipped(article.title);
      continue;
    }

    progress.processing(article);
    try {
      await saveArticle(client, article, path, kepub, fetchMeta, series, index);
      tally.saved++;
      progress.saved();
    } catch (err) {
      // A rejected token won't recover article-to-article - abort the whole run.
      if (err instanceof InstapaperAuthError) {
        await progress.abort();
        throw err;
      }
      // Instapaper can't extract text for this one - skip it, don't fail.
      if (err instanceof InstapaperContentError) {
        tally.unsupported++;
        progress.noText(article.title);
      } else {
        tally.failed++;
        progress.failed(`${article.title} - ${errorMessage(err)}`);
      }
    }
  }

  await progress.finish();
}

/**
 * Per-folder progress reporting: a live bar on a terminal, plain log lines
 * otherwise. "No text" / failure messages are deferred and flushed at the end so
 * they don't fight the bar's redraws. Each article advances the bar exactly once.
 */
class FolderProgress {
  private readonly interactive = Deno.stderr.isTerminal();
  private readonly bar?: ProgressBar;
  private readonly noTextTitles: string[] = [];
  private readonly failures: string[] = [];
  private current = "";

  constructor(total: number) {
    if (!this.interactive) return;
    this.bar = new ProgressBar({
      max: total,
      barLength: 24,
      formatter: (x) =>
        `  [${x.styledTime}] [${x.progressBar}] ${x.value}/${x.max}  ${this.current}`,
    });
  }

  /** Set the article shown next to the bar. */
  track(title: string): void {
    this.current = truncate(title, 40);
  }

  skipped(title: string): void {
    if (!this.interactive) log.step(`Skipping (exists): ${title}`);
    this.advance();
  }

  processing(article: Article): void {
    if (!this.interactive) log.step(`Processing ${article.id} - ${article.title}`);
  }

  saved(): void {
    this.advance();
  }

  noText(title: string): void {
    if (this.interactive) this.noTextTitles.push(title);
    else log.warn(`No text from Instapaper: ${title}`);
    this.advance();
  }

  failed(message: string): void {
    if (this.interactive) this.failures.push(message);
    else log.error(`Failed: ${message}`);
    this.advance();
  }

  /** Stop the bar without flushing — for an aborting error. */
  async abort(): Promise<void> {
    if (this.bar) await this.bar.stop();
  }

  /** Stop the bar and print the deferred messages. */
  async finish(): Promise<void> {
    if (this.bar) await this.bar.stop();
    for (const title of this.noTextTitles) log.warn(`No text from Instapaper: ${title}`);
    for (const message of this.failures) log.error(`Failed: ${message}`);
  }

  private advance(): void {
    if (this.bar) this.bar.value++;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

async function saveArticle(
  client: InstapaperClient,
  article: Article,
  path: string,
  kepub: boolean,
  fetchMeta: boolean,
  series?: string,
  seriesIndex?: number,
): Promise<void> {
  const html = await client.getText(article.id);
  // Instapaper supplies no byline or cover, so when enabled we read both from the
  // article's own page. The folder-derived `article.author` stays the fallback.
  const meta = fetchMeta ? await fetchPageMetadata(article.url) : {};

  const epub = await generateEpub({
    title: article.title,
    author: meta.author ?? article.author,
    cover: meta.image,
    series,
    seriesIndex,
    includeToc: false,
    coverFromLeadImage: true,
    coverBackground: COVER_BACKGROUND,
    transformImage: transcodeForKobo,
    transformCover: coverArtist(sourceDomain(article.url)),
    chapters: [{ title: article.title, html, excludeFromToc: true }],
  });

  const bytes = kepub ? toKepub(epub) : epub;
  await Deno.writeFile(path, bytes);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printHelp(): void {
  console.log(`instakobo generate - build (K)EPUBs from your Instapaper articles

USAGE:
  instakobo generate [options]

OPTIONS:
  -o, --out-dir <dir>       Output directory (default: ./kepub)
      --skip-kepub          Produce plain EPUB instead of Kobo kepub
      --skip-meta           Don't fetch each article's page for cover art and
                            byline (faster/offline; uses a generic author)
      --force               Re-generate articles even if the file exists
      --limit <n>           Max articles per folder (default: 500, API max)
  -h, --help                Show this help

CREDENTIALS:
  Run "instakobo setup" once to save them. To override, set environment
  variables (INSTAPAPER_KEY/SECRET plus INSTAPAPER_TOKEN/TOKEN_SECRET, or
  INSTAPAPER_USERNAME/PASSWORD) or pass the matching --instapaper-* flags.`);
}
