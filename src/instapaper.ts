import { type OAuthConsumer, type OAuthToken, signRequest } from "./oauth.ts";

const BASE_URL = "https://www.instapaper.com/api/";

/**
 * How the client authenticates: either a previously obtained access token (the
 * preferred path - no password on disk, no per-run exchange) or a username and
 * password to exchange for one via xAuth.
 */
export type InstapaperAuth =
  | { token: OAuthToken }
  | { username: string; password: string };

/**
 * Thrown when Instapaper rejects our credentials (HTTP 401/403) - e.g. a stored
 * access token was revoked or the password changed. Lets callers tell the user
 * to re-authenticate rather than surfacing a raw HTTP error.
 */
export class InstapaperAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstapaperAuthError";
  }
}

/**
 * Thrown when Instapaper can't produce a result for a specific item - e.g. it
 * fails to extract a text version of an article (error 1550). This is permanent
 * for that item, so callers should skip it, not retry or treat it as a crash.
 */
export class InstapaperContentError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "InstapaperContentError";
  }
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

// Error codes meaning "can't be done for this item" (as opposed to transient).
const CONTENT_ERROR_CODES = new Set([1550]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
// Abort a stalled request so it becomes a retryable timeout instead of hanging.
const REQUEST_TIMEOUT_MS = 30_000;

/** Extract Instapaper's `{type:"error", ...}` envelope from a response body. */
function parseApiError(
  text: string,
): { code: number; message: string } | undefined {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      const err = data.find((d): d is RawError => d?.type === "error");
      if (err) return { code: err.error_code, message: err.message };
    }
  } catch {
    // Not JSON (e.g. an HTML gateway error page); fall through.
  }
  return undefined;
}

export interface Folder {
  id: number;
  title: string;
  slug: string;
}

export interface Article {
  id: number;
  url: string;
  title: string;
  author: string;
  folder?: Folder;
}

export interface Highlight {
  id: number;
  text: string;
  note?: string;
  position: number;
}

/** The authenticated Instapaper account, from `account/verify_credentials`. */
export interface Account {
  userId: number;
  username: string;
  subscriptionActive: boolean;
}

/** Raw shapes returned by the Instapaper Full API (only fields we use). */
interface RawBookmark {
  type: string;
  bookmark_id: number;
  title: string;
  url: string;
}
interface RawFolder {
  folder_id: number;
  title: string;
  slug: string;
}
interface RawHighlight {
  highlight_id: number;
  text: string;
  note?: string;
  position: number;
}
interface RawUser {
  type: "user";
  user_id: number;
  username: string;
  subscription_is_active?: string;
}
interface RawError {
  type: "error";
  error_code: number;
  message: string;
}

/**
 * A small, dependency-free Instapaper Full API client. Reimplements just the
 * surface instakobo needs (the original used an npm SDK built on the deprecated
 * `request` library, which does not run on Deno).
 */
export class InstapaperClient {
  private token?: OAuthToken;

  constructor(
    private readonly consumer: OAuthConsumer,
    private readonly auth: InstapaperAuth,
  ) {
    if ("token" in auth) this.token = auth.token;
  }

  private nonce(): string {
    return crypto.randomUUID().replaceAll("-", "");
  }

  private timestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  private async send(
    path: string,
    params: Record<string, string>,
    token?: OAuthToken,
  ): Promise<Response> {
    const url = BASE_URL + path;
    const { authHeader, body } = await signRequest({
      method: "POST",
      url,
      consumer: this.consumer,
      token,
      params,
      nonce: this.nonce(),
      timestamp: this.timestamp(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sends a signed request, retrying transient failures (5xx and network errors)
   * with backoff and translating Instapaper's error envelope into typed errors.
   * Returns the raw success body. Doesn't acquire a token - callers authorize
   * first (and {@link authorize} itself uses this for the xAuth call).
   */
  private async request(
    path: string,
    params: Record<string, string>,
  ): Promise<string> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.send(path, params, this.token);
      } catch (err) {
        // Network failure or timeout - transient, so retry.
        lastError = err instanceof Error && err.name === "AbortError"
          ? new Error(
            `Instapaper request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`,
          )
          : err instanceof Error
          ? err
          : new Error(String(err));
        await this.backoff(attempt);
        continue;
      }

      const text = await res.text();

      if (isAuthFailure(res.status)) {
        throw new InstapaperAuthError(
          `Instapaper rejected your credentials (HTTP ${res.status}).`,
        );
      }
      if (res.status >= 500) {
        lastError = new Error(
          `Instapaper is unavailable (HTTP ${res.status}).`,
        );
        await this.backoff(attempt);
        continue;
      }

      // Logical errors come as an envelope, sometimes with a 4xx and sometimes
      // with HTTP 200 - so inspect the body on both success and failure.
      const apiError = parseApiError(text);
      if (apiError) {
        if (CONTENT_ERROR_CODES.has(apiError.code)) {
          throw new InstapaperContentError(apiError.message, apiError.code);
        }
        throw new Error(
          `Instapaper error ${apiError.code}: ${apiError.message}`,
        );
      }
      if (!res.ok) {
        throw new Error(`Instapaper request failed (HTTP ${res.status}).`);
      }
      return text;
    }
    throw lastError ?? new Error("Instapaper request failed after retries.");
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt));
  }

  /**
   * Ensures an access token is available. With a stored token this is a no-op;
   * otherwise it exchanges the username/password for one via xAuth.
   */
  async authorize(): Promise<void> {
    if (this.token) return;
    if (!("username" in this.auth)) {
      throw new Error(
        "No access token available and no username/password to obtain one.",
      );
    }
    const text = await this.request("1/oauth/access_token", {
      x_auth_username: this.auth.username,
      x_auth_password: this.auth.password,
      x_auth_mode: "client_auth",
    });
    const parsed = new URLSearchParams(text);
    const key = parsed.get("oauth_token");
    const secret = parsed.get("oauth_token_secret");
    if (!key || !secret) {
      throw new Error("Unexpected response from Instapaper authorization.");
    }
    this.token = { key, secret };
  }

  /**
   * Authenticates and returns the access token, so it can be persisted (used by
   * `instakobo setup` to exchange a password for a long-lived token once).
   */
  async login(): Promise<OAuthToken> {
    await this.authorize();
    return this.token!;
  }

  private async apiJson<T>(
    path: string,
    params: Record<string, string> = {},
    version = "1",
  ): Promise<T> {
    await this.authorize();
    const text = await this.request(version + path, params);
    return JSON.parse(text) as T;
  }

  /** Confirms the credentials are valid and return the authenticated account. */
  async verifyCredentials(): Promise<Account> {
    const data = await this.apiJson<RawUser[]>("/account/verify_credentials");
    const user = data.find((d) => d?.type === "user");
    if (!user) {
      throw new Error("Unexpected response from account/verify_credentials.");
    }
    return {
      userId: user.user_id,
      username: user.username,
      subscriptionActive: user.subscription_is_active === "1",
    };
  }

  async getFolders(): Promise<Folder[]> {
    const folders = await this.apiJson<RawFolder[]>("/folders/list");
    return folders
      .filter((f) => typeof f.folder_id === "number")
      .map((f) => ({ id: f.folder_id, title: f.title, slug: f.slug }));
  }

  async getArticles(folder?: Folder, limit = 500): Promise<Article[]> {
    const params: Record<string, string> = { limit: String(limit) };
    if (folder) params.folder_id = String(folder.id);

    const items = await this.apiJson<RawBookmark[]>("/bookmarks/list", params);
    return items
      .filter((item) => item.type === "bookmark")
      .map((item) => ({
        id: item.bookmark_id,
        url: item.url,
        title: item.title,
        author: folder ? `Instapaper - ${folder.title}` : "Instapaper",
        folder,
      }));
  }

  /** The processed article body as HTML. */
  async getText(id: number): Promise<string> {
    await this.authorize();
    return await this.request("1/bookmarks/get_text", {
      bookmark_id: String(id),
    });
  }

  async updateProgress(
    id: number,
    progress: number,
    progressTimestamp: number,
  ): Promise<void> {
    await this.apiJson("/bookmarks/update_read_progress", {
      bookmark_id: String(id),
      progress: String(progress),
      progress_timestamp: String(progressTimestamp),
    });
  }

  async archive(id: number): Promise<void> {
    await this.apiJson("/bookmarks/archive", { bookmark_id: String(id) });
  }

  async getHighlights(id: number): Promise<Highlight[]> {
    const items = await this.apiJson<RawHighlight[]>(
      `/bookmarks/${id}/highlights`,
      {},
      "1.1",
    );
    return items.map((h) => ({
      id: h.highlight_id,
      text: h.text.trim(),
      note: h.note,
      position: h.position,
    }));
  }

  async addHighlight(id: number, text: string, position = 0): Promise<void> {
    await this.apiJson(
      `/bookmarks/${id}/highlight`,
      { text, position: String(position) },
      "1.1",
    );
  }
}
