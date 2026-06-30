#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
import denoConfig from "./deno.json" with { type: "json" };
import { loadEnv } from "./src/config.ts";
import { generate } from "./src/generate.ts";
import { InstapaperAuthError } from "./src/instapaper.ts";
import { log } from "./src/log.ts";
import { runSetup } from "./src/setup.ts";
import { sync } from "./src/sync.ts";

// Single source of truth: the version in deno.json (kept in step with the v* tag).
const VERSION = denoConfig.version;

function printHelp(): void {
  console.log(`instakobo ${VERSION} - read your Instapaper articles on a Kobo

USAGE:
  instakobo <command> [options]

COMMANDS:
  setup       Save your Instapaper credentials (run this first)
  generate    Build (K)EPUBs from your Instapaper articles
  sync        Push reading progress and highlights back to Instapaper

Run "instakobo <command> --help" for command-specific options.`);
}

async function main(): Promise<number> {
  const [command, ...rest] = Deno.args;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return 0;
  }

  await loadEnv();

  switch (command) {
    case "setup":
      await runSetup();
      return 0;
    case "generate":
      return await generate(rest);
    case "sync":
      return await sync(rest);
    default:
      log.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

try {
  Deno.exit(await main());
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  if (err instanceof InstapaperAuthError) {
    log.info(
      'Your saved credentials may have been revoked - run "instakobo setup" to re-authenticate.',
    );
  }
  Deno.exit(1);
}
