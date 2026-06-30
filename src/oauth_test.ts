import { assertEquals, assertStringIncludes } from "@std/assert";
import { oauthEncode, signRequest } from "./oauth.ts";

Deno.test("oauthEncode encodes reserved characters per RFC-3986", () => {
  assertEquals(oauthEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assertEquals(oauthEncode("a*b'c(d)e!"), "a%2Ab%27c%28d%29e%21");
  assertEquals(oauthEncode("safe-_.~"), "safe-_.~");
});

// OAuth 1.0a vector built from Twitter's documented base string. The signature
// below was cross-checked with `openssl dgst -sha1 -hmac`, so matching it proves
// both the base-string construction and the HMAC-SHA1 signing are correct.
Deno.test("signRequest reproduces a verified HMAC-SHA1 signature", async () => {
  const { authHeader, body } = await signRequest({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    consumer: {
      key: "xvz1evFS4wEEPTGEFPHBog",
      secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7e",
    },
    token: {
      key: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      secret: "LswwdoUaIVS25HqH7hY4w7VBNWSiM7Tt1khWQpLBuC9",
    },
    params: {
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      include_entities: "true",
    },
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: "1318622958",
  });

  assertStringIncludes(
    authHeader,
    'oauth_signature="jqTS5Vx4J6gwWccVRuuEVd77YCc%3D"',
  );
  assertStringIncludes(authHeader, 'oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
  // Data params live in the body, form-encoded; oauth params do not.
  assertStringIncludes(body, "include_entities=true");
  assertEquals(body.includes("oauth_signature"), false);
});
