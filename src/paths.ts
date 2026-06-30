import { join } from "@std/path";

/**
 * Resolves instakobo's config directory following the XDG Base Directory spec:
 * `$XDG_CONFIG_HOME/instakobo`, falling back to `~/.config/instakobo`.
 */
export function configDir(): string {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  const base = xdg && xdg.trim() ? xdg : join(homeDir(), ".config");
  return join(base, "instakobo");
}

/** The saved-credentials file (a `KEY=VALUE` env-style file, mode 0600). */
export function configFile(): string {
  return join(configDir(), "config");
}

function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error(
      "Cannot determine home directory: neither HOME nor USERPROFILE is set.",
    );
  }
  return home;
}
