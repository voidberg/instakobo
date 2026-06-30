import { DB } from "sqlite";
import { basename, join } from "@std/path";

export interface KoboArticle {
  /** Instapaper bookmark id, recovered from the filename. */
  id: number;
  /** Kobo ContentID (e.g. `file:///mnt/onboard/...`). */
  koboId: string;
  title: string;
  folder?: string;
  /** Reading progress in the range 0–1. */
  progress: number;
  /** Unix seconds of the last read time, if known. */
  progressTimestamp?: number;
  fileName: string;
}

export function koboDbPath(base: string): string {
  return join(base, ".kobo/KoboReader.sqlite");
}

/**
 * A read-only view over the Kobo SQLite database.
 *
 * Kobo writes its database in WAL mode, but the pure-WASM SQLite we bundle (so
 * the CLI compiles to one self-contained binary) is built without WAL support
 * and refuses such files. We therefore copy the database to a private temp file
 * and flip its header's format flags from 2 (WAL) back to 1 (rollback journal).
 * The device's own file is never modified, and the data is intact because Kobo
 * checkpoints the WAL into the main file when the volume is ejected.
 */
export class KoboDatabase {
  private constructor(
    private readonly db: DB,
    private readonly tempPath: string,
  ) {}

  static open(path: string): KoboDatabase {
    const bytes = Deno.readFileSync(path);
    // Bytes 18/19 are the write/read file-format versions; 2 means "needs WAL".
    if (bytes[18] === 2 && bytes[19] === 2) {
      bytes[18] = 1;
      bytes[19] = 1;
    }
    const tempPath = Deno.makeTempFileSync({
      prefix: "instakobo-",
      suffix: ".sqlite",
    });
    Deno.writeFileSync(tempPath, bytes);
    return new KoboDatabase(new DB(tempPath), tempPath);
  }

  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[] {
    // deno-lint-ignore no-explicit-any
    return this.db.queryEntries<any>(sql, params as any) as T[];
  }

  close(): void {
    this.db.close();
    try {
      Deno.removeSync(this.tempPath);
    } catch {
      // Best-effort cleanup of the temp copy.
    }
  }
}

interface ContentRow extends Record<string, unknown> {
  ContentID: string;
  Title: string;
  DateLastRead: string | null;
  PercentRead: number | null;
}

/** Every Instapaper article currently on the device. */
export function getArticles(db: KoboDatabase): KoboArticle[] {
  const rows = db.query<ContentRow>(
    `SELECT ContentID, Title, DateLastRead, ___PercentRead AS PercentRead
       FROM content
      WHERE ContentType = 6 AND ContentID LIKE '%-ipaper-%'`,
  );

  return rows.map((row) => {
    const fileName = basename(row.ContentID);
    const parts = fileName
      .replace(".kepub.epub", "")
      .replace(/\.epub$/, "")
      .split("-");
    const id = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    const maybeFolder = parts[parts.length - 2];
    const folder = maybeFolder && maybeFolder !== "ipaper" ? maybeFolder : undefined;

    const progressTimestamp = row.DateLastRead
      ? Math.floor(new Date(row.DateLastRead).getTime() / 1000)
      : undefined;

    return {
      id,
      koboId: row.ContentID,
      title: row.Title,
      folder,
      progress: (row.PercentRead ?? 0) / 100,
      progressTimestamp,
      fileName,
    };
  });
}

/** Highlighted passages for a given article (Kobo ContentID). */
export function getHighlights(db: KoboDatabase, koboId: string): string[] {
  const rows = db.query<{ Text: string }>(
    `SELECT Text FROM bookmark
      WHERE Text IS NOT NULL AND Text <> '' AND VolumeId = ?`,
    [koboId],
  );
  return rows.map((r) => r.Text.trim()).filter((t) => t.length > 0);
}

function articlePath(base: string, koboId: string): string {
  return join(base, koboId.replace("file:///mnt/onboard/", ""));
}

/** Deletes an article file from the mounted Kobo device. */
export function removeKoboArticle(koboId: string, koboDir: string): void {
  Deno.removeSync(articlePath(koboDir, koboId));
}

/** Deletes an article from the local (K)EPUB output directory. */
export function removeLocalArticle(outDir: string, article: KoboArticle): void {
  Deno.removeSync(join(outDir, article.folder ?? "", article.fileName));
}
