import { Input, Secret } from "@cliffy/prompt";
import {
  MissingCredentialsError,
  resolveAuth,
  type ResolvedAuth,
  writeStoredConfig,
} from "./config.ts";
import { InstapaperAuthError, InstapaperClient } from "./instapaper.ts";
import { log, Spinner } from "./log.ts";

/**
 * Interactive credential setup: prompt for the four values, verify them with a
 * one-time xAuth exchange, then persist the consumer key/secret and the resulting
 * access token (never the password) to the XDG config file.
 */
export async function runSetup(): Promise<ResolvedAuth> {
  if (!Deno.stdin.isTerminal()) {
    throw new Error(
      "`instakobo setup` is interactive and needs a terminal. Set credentials via environment variables or --instapaper-* flags instead.",
    );
  }

  log.heading("instakobo setup");
  console.error(
    "In order to work, Instakobo needs two things:\n" +
      "  - An OAuth consumer key and secret. Register an application on the Instapaper developers page: https://www.instapaper.com/developers\n" +
      "  - Your Instapaper login (username or email, and password)\n\n" +
      "Instakobo will use these to authenticate you and will save the access token, consumer key and secret. Your password is never saved.\n",
  );

  const key = await Input.prompt({
    message: "OAuth consumer key",
    minLength: 1,
  });
  const secret = await Secret.prompt({
    message: "OAuth consumer secret",
    minLength: 1,
  });
  const username = await Input.prompt({
    message: "Instapaper username or email",
    minLength: 1,
  });
  const password = await Secret.prompt({
    message: "Instapaper password",
    minLength: 1,
  });

  const consumer = { key, secret };
  const spinner = new Spinner("Verifying with Instapaper...").start();
  let token;
  try {
    token = await new InstapaperClient(consumer, {
      username,
      password,
    }).login();
  } catch (err) {
    spinner.stop();
    // Re-throw as a plain error with setup-specific guidance, so the top-level
    // handler doesn't also append the generic "run setup" hint.
    const detail = err instanceof InstapaperAuthError
      ? ""
      : `: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(
      `Could not verify those credentials${detail}. Double-check your consumer key/secret and Instapaper login, then run "instakobo setup" again.`,
    );
  }
  spinner.succeed("Credentials verified.");

  const path = writeStoredConfig({
    INSTAPAPER_KEY: key,
    INSTAPAPER_SECRET: secret,
    INSTAPAPER_TOKEN: token.key,
    INSTAPAPER_TOKEN_SECRET: token.secret,
  });
  log.success(`Saved to ${path} - your password was not stored.`);

  return { consumer, auth: { token } };
}

/**
 * Resolves credentials, falling back to interactive setup when none are found and
 * stdin is a terminal. In non-interactive contexts (CI, pipes) the original
 * {@link MissingCredentialsError} propagates so the run fails fast.
 */
async function resolveAuthOrSetup(
  flags: Record<string, unknown>,
): Promise<ResolvedAuth> {
  try {
    return resolveAuth(flags);
  } catch (err) {
    if (!(err instanceof MissingCredentialsError) || !Deno.stdin.isTerminal()) {
      throw err;
    }
    log.warn(
      "No Instapaper credentials found - let's set them up (just once).",
    );
    return await runSetup();
  }
}

/**
 * Resolves credentials (running setup if needed), builds a client, and confirms the
 * token is valid by fetching the account - surfacing who you're logged in as and
 * failing fast with a clear message if the token has been revoked.
 */
export async function connect(
  flags: Record<string, unknown>,
): Promise<InstapaperClient> {
  const { consumer, auth } = await resolveAuthOrSetup(flags);
  const client = new InstapaperClient(consumer, auth);
  const account = await client.verifyCredentials();
  log.info(`Logged in as ${account.username}.`);
  return client;
}
