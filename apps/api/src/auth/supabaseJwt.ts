/**
 * Verifies Supabase Auth access tokens (ES256 JWTs) against the project's JWKS,
 * using Node's WebCrypto. No dependency needed for one algorithm.
 */
import { webcrypto } from "node:crypto";

export type RecipientIdentity = { sub: string; email: string | null; name: string | null };
export type VerifyRecipient = (token: string) => Promise<RecipientIdentity | null>;

type Jwk = webcrypto.JsonWebKey & { kid?: string; alg?: string };

const b64urlDecode = (s: string) => Buffer.from(s, "base64url");

export function createSupabaseVerifier(opts: {
  jwksUrl: string;
  issuer: string;
  audience?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
}): VerifyRecipient {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const audience = opts.audience ?? "authenticated";
  let keys: Map<string, webcrypto.CryptoKey> | null = null;

  async function loadKeys(): Promise<Map<string, webcrypto.CryptoKey>> {
    const res = await fetchFn(opts.jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const { keys: jwks } = (await res.json()) as { keys: Jwk[] };
    const map = new Map<string, webcrypto.CryptoKey>();
    for (const jwk of jwks) {
      if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.kid) continue;
      map.set(
        jwk.kid,
        await webcrypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
      );
    }
    return map;
  }

  return async (token) => {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let payload: { sub?: string; iss?: string; aud?: string | string[]; exp?: number; email?: string; user_metadata?: { full_name?: string; name?: string } };
    try {
      header = JSON.parse(b64urlDecode(h).toString("utf8"));
      payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    } catch {
      return null; // not a JWT at all: unauthenticated, not an error
    }
    if (header.alg !== "ES256" || !header.kid) return null;

    if (!keys || !keys.has(header.kid)) keys = await loadKeys(); // refresh on unknown kid (key rotation)
    const key = keys.get(header.kid);
    if (!key) return null;

    const ok = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlDecode(s),
      Buffer.from(`${h}.${p}`),
    );
    if (!ok) return null;
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience;
    if (payload.iss !== opts.issuer || !audOk || !payload.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) return null;
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      name: payload.user_metadata?.full_name ?? payload.user_metadata?.name ?? null,
    };
  };
}
