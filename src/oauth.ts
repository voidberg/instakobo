/**
 * Minimal OAuth 1.0a (HMAC-SHA1) request signing, implemented with Web Crypto so
 * it runs natively on Deno with no third-party dependency. Instapaper's Full API
 * uses OAuth 1.0a with xAuth for obtaining an access token.
 */

export interface OAuthConsumer {
  key: string;
  secret: string;
}

export interface OAuthToken {
  key: string;
  secret: string;
}

/** RFC-3986 percent-encoding (stricter than `encodeURIComponent`). */
export function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmacSha1(
  baseString: string,
  signingKey: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(baseString),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export interface SignOptions {
  method: string;
  url: string;
  consumer: OAuthConsumer;
  token?: OAuthToken;
  /** Body parameters; included in the signature as required for form posts. */
  params: Record<string, string>;
  nonce: string;
  timestamp: string;
}

export interface SignedRequest {
  authHeader: string;
  body: string;
}

/**
 * Produces the `Authorization` header and form-encoded body for a signed OAuth
 * 1.0a request. OAuth parameters travel in the header; the caller's `params`
 * become the request body (and are folded into the signature base string).
 */
export async function signRequest(opts: SignOptions): Promise<SignedRequest> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: opts.consumer.key,
    oauth_nonce: opts.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp,
    oauth_version: "1.0",
  };
  if (opts.token) oauthParams.oauth_token = opts.token.key;

  const allParams = { ...opts.params, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${oauthEncode(k)}=${oauthEncode(allParams[k]!)}`)
    .join("&");

  const baseString = [
    opts.method.toUpperCase(),
    oauthEncode(opts.url),
    oauthEncode(paramString),
  ].join("&");

  const signingKey = `${oauthEncode(opts.consumer.secret)}&${
    oauthEncode(
      opts.token?.secret ?? "",
    )
  }`;
  oauthParams.oauth_signature = await hmacSha1(baseString, signingKey);

  const authHeader = `OAuth ${
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${oauthEncode(k)}="${oauthEncode(oauthParams[k]!)}"`)
      .join(", ")
  }`;

  const body = Object.keys(opts.params)
    .map((k) => `${oauthEncode(k)}=${oauthEncode(opts.params[k]!)}`)
    .join("&");

  return { authHeader, body };
}
