import { assertEquals, assertRejects } from "@std/assert";
import { InstapaperAuthError, InstapaperClient, InstapaperContentError } from "./instapaper.ts";

function stubFetch(status: number, body = ""): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(body, { status }))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Stub fetch to return a sequence of responses, tracking how many calls occur. */
function stubFetchSequence(
  responses: Array<{ status: number; body?: string }>,
): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (() => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return Promise.resolve(new Response(r.body ?? "", { status: r.status }));
  }) as typeof fetch;
  return { restore: () => (globalThis.fetch = original), calls: () => i };
}

Deno.test("a 401 on an API call surfaces as InstapaperAuthError", async () => {
  const restore = stubFetch(401, "Invalid or expired token");
  try {
    const client = new InstapaperClient(
      { key: "k", secret: "s" },
      { token: { key: "t", secret: "ts" } },
    );
    await assertRejects(() => client.getFolders(), InstapaperAuthError);
  } finally {
    restore();
  }
});

Deno.test("a 403 during xAuth login surfaces as InstapaperAuthError", async () => {
  const restore = stubFetch(403, "Invalid xAuth credentials");
  try {
    const client = new InstapaperClient(
      { key: "k", secret: "s" },
      { username: "u", password: "p" },
    );
    await assertRejects(() => client.login(), InstapaperAuthError);
  } finally {
    restore();
  }
});

Deno.test("a 1550 (can't extract text) surfaces as InstapaperContentError", async () => {
  const restore = stubFetch(
    400,
    JSON.stringify([
      { type: "error", error_code: 1550, message: "Error generating text version of this URL" },
    ]),
  );
  try {
    const client = new InstapaperClient(
      { key: "k", secret: "s" },
      { token: { key: "t", secret: "ts" } },
    );
    await assertRejects(() => client.getText(123), InstapaperContentError);
  } finally {
    restore();
  }
});

Deno.test("a transient 5xx is retried, then succeeds", async () => {
  const seq = stubFetchSequence([
    { status: 503 },
    { status: 200, body: JSON.stringify([{ folder_id: 1, title: "F", slug: "f" }]) },
  ]);
  try {
    const client = new InstapaperClient(
      { key: "k", secret: "s" },
      { token: { key: "t", secret: "ts" } },
    );
    const folders = await client.getFolders();
    assertEquals(folders.length, 1);
    assertEquals(seq.calls(), 2); // first 503, retried once
  } finally {
    seq.restore();
  }
});

Deno.test("verifyCredentials returns the authenticated account", async () => {
  const restore = stubFetch(
    200,
    JSON.stringify([
      { type: "user", user_id: 42, username: "you@example.com", subscription_is_active: "1" },
    ]),
  );
  try {
    const client = new InstapaperClient(
      { key: "k", secret: "s" },
      { token: { key: "t", secret: "ts" } },
    );
    assertEquals(await client.verifyCredentials(), {
      userId: 42,
      username: "you@example.com",
      subscriptionActive: true,
    });
  } finally {
    restore();
  }
});
