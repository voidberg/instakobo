import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { configDir, configFile } from "./paths.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    prev.set(k, Deno.env.get(k));
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("configDir honors XDG_CONFIG_HOME", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/xdg" }, () => {
    assertEquals(configDir(), join("/tmp/xdg", "instakobo"));
  });
});

Deno.test("configDir falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
  withEnv({ XDG_CONFIG_HOME: undefined, HOME: "/home/tester" }, () => {
    assertEquals(configDir(), join("/home/tester", ".config", "instakobo"));
    assertEquals(configFile(), join("/home/tester", ".config", "instakobo", "config"));
  });
});

Deno.test("configDir ignores a blank XDG_CONFIG_HOME", () => {
  withEnv({ XDG_CONFIG_HOME: "  ", HOME: "/home/tester" }, () => {
    assertEquals(configDir(), join("/home/tester", ".config", "instakobo"));
  });
});
