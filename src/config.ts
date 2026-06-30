import { load, parse } from "@std/dotenv";
import type { InstapaperAuth } from "./instapaper.ts";
import type { OAuthConsumer } from "./oauth.ts";
import { configDir, configFile } from "./paths.ts";

export interface ResolvedAuth {
  consumer: OAuthConsumer;
  auth: InstapaperAuth;
}

/** Thrown when no usable credentials are found, so callers can offer setup. */
export class MissingCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialsError";
  }
}

/** Loads a local `.env` if present. */
export async function loadEnv(): Promise<void> {
  try {
    await load({ export: true });
  } catch {
    // Missing/locked .env is fine - values can still come from the environment.
  }
}

/** Reads the saved config file, returning an empty object when it doesn't exist. */
export function readStoredConfig(): Record<string, string> {
  try {
    return parse(Deno.readTextFileSync(configFile()));
  } catch {
    return {};
  }
}

/** Writes the saved config file (owner-only, mode 0600), creating its dir. */
export function writeStoredConfig(values: Record<string, string>): string {
  Deno.mkdirSync(configDir(), { recursive: true });
  const path = configFile();
  const body = `${
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  }\n`;
  Deno.writeTextFileSync(path, body, { mode: 0o600 });
  // Tighten perms even if the file already existed with a looser mode.
  try {
    Deno.chmodSync(path, 0o600);
  } catch {
    // chmod is unsupported on some platforms (e.g. Windows); ignore.
  }
  return path;
}

/**
 * Resolves Instapaper credentials, preferring flags over environment variables
 * over the saved config file. Returns the consumer plus an auth method: a stored
 * access token when available, otherwise a username/password to exchange. Throws
 * {@link MissingCredentialsError} when nothing usable is found.
 */
export function resolveAuth(
  flags: Record<string, unknown>,
  stored: Record<string, string> = readStoredConfig(),
): ResolvedAuth {
  const pick = (flag: string, env: string): string | undefined =>
    (flags[flag] as string | undefined) ?? Deno.env.get(env) ?? stored[env];

  const key = pick("instapaper-key", "INSTAPAPER_KEY");
  const secret = pick("instapaper-secret", "INSTAPAPER_SECRET");
  const token = pick("instapaper-token", "INSTAPAPER_TOKEN");
  const tokenSecret = pick(
    "instapaper-token-secret",
    "INSTAPAPER_TOKEN_SECRET",
  );
  const username = pick("instapaper-user", "INSTAPAPER_USERNAME");
  const password = pick("instapaper-pass", "INSTAPAPER_PASSWORD");

  if (!key || !secret) {
    throw new MissingCredentialsError(
      `Missing Instapaper consumer credentials: ${
        [
          ["INSTAPAPER_KEY", key],
          ["INSTAPAPER_SECRET", secret],
        ]
          .filter(([, v]) => !v)
          .map(([n]) => n)
          .join(
            ", ",
          )
      }. Run "instakobo setup", or set them in the environment or via --instapaper-* flags.`,
    );
  }

  const consumer: OAuthConsumer = { key, secret };
  if (token && tokenSecret) {
    return { consumer, auth: { token: { key: token, secret: tokenSecret } } };
  }
  if (username && password) {
    return { consumer, auth: { username, password } };
  }

  throw new MissingCredentialsError(
    'No Instapaper access token or username/password found. Run "instakobo setup".',
  );
}
