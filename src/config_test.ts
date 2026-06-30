import { assertEquals, assertThrows } from "@std/assert";
import {
  MissingCredentialsError,
  readStoredConfig,
  resolveAuth,
  writeStoredConfig,
} from "./config.ts";

const ENV_KEYS = [
  "INSTAPAPER_KEY",
  "INSTAPAPER_SECRET",
  "INSTAPAPER_TOKEN",
  "INSTAPAPER_TOKEN_SECRET",
  "INSTAPAPER_USERNAME",
  "INSTAPAPER_PASSWORD",
];

// Ensure ambient INSTAPAPER_* env (e.g. a dev's real creds) can't leak in.
function clearEnv(): void {
  for (const k of ENV_KEYS) Deno.env.delete(k);
}

Deno.test("resolveAuth prefers a stored access token over username/password", () => {
  clearEnv();
  const r = resolveAuth({}, {
    INSTAPAPER_KEY: "k",
    INSTAPAPER_SECRET: "s",
    INSTAPAPER_TOKEN: "t",
    INSTAPAPER_TOKEN_SECRET: "ts",
    INSTAPAPER_USERNAME: "u",
    INSTAPAPER_PASSWORD: "p",
  });
  assertEquals(r.consumer, { key: "k", secret: "s" });
  assertEquals(r.auth, { token: { key: "t", secret: "ts" } });
});

Deno.test("resolveAuth falls back to username/password when no token", () => {
  clearEnv();
  const r = resolveAuth({}, {
    INSTAPAPER_KEY: "k",
    INSTAPAPER_SECRET: "s",
    INSTAPAPER_USERNAME: "u",
    INSTAPAPER_PASSWORD: "p",
  });
  assertEquals(r.auth, { username: "u", password: "p" });
});

Deno.test("flags override stored values", () => {
  clearEnv();
  const r = resolveAuth({ "instapaper-token": "flagtok", "instapaper-token-secret": "flagsec" }, {
    INSTAPAPER_KEY: "k",
    INSTAPAPER_SECRET: "s",
    INSTAPAPER_TOKEN: "storedtok",
    INSTAPAPER_TOKEN_SECRET: "storedsec",
  });
  assertEquals(r.auth, { token: { key: "flagtok", secret: "flagsec" } });
});

Deno.test("resolveAuth throws when consumer credentials are missing", () => {
  clearEnv();
  assertThrows(() => resolveAuth({}, {}), MissingCredentialsError);
});

Deno.test("resolveAuth throws when only the consumer is present", () => {
  clearEnv();
  assertThrows(
    () => resolveAuth({}, { INSTAPAPER_KEY: "k", INSTAPAPER_SECRET: "s" }),
    MissingCredentialsError,
  );
});

Deno.test("writeStoredConfig round-trips and is owner-only (0600)", () => {
  const tmp = Deno.makeTempDirSync();
  const prev = Deno.env.get("XDG_CONFIG_HOME");
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  try {
    const path = writeStoredConfig({ INSTAPAPER_KEY: "k", INSTAPAPER_TOKEN: "t" });
    const read = readStoredConfig();
    assertEquals(read.INSTAPAPER_KEY, "k");
    assertEquals(read.INSTAPAPER_TOKEN, "t");
    const mode = Deno.statSync(path).mode;
    if (mode !== null) assertEquals(mode & 0o777, 0o600);
  } finally {
    Deno.removeSync(tmp, { recursive: true });
    if (prev === undefined) Deno.env.delete("XDG_CONFIG_HOME");
    else Deno.env.set("XDG_CONFIG_HOME", prev);
  }
});
