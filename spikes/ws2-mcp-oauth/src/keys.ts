// Mock AS signing keys + JWT mint/verify.
// ES256 keypair generated in memory at startup. Public JWKS served at /jwks.json.

import { generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK } from "jose";
import type { JWK, CryptoKey } from "jose";
import { randomUUID } from "node:crypto";
import { ISSUER } from "./config.js";

const ALG = "ES256";

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let publicJwk: JWK;
let kid: string;
let initialized = false;

// Idempotent: in `verify:all` the server and reference client share this module
// in one process, so a second call must NOT regenerate the keypair (that would
// desync the server's verifier from the tokens /token already mints).
export async function initKeys(): Promise<void> {
  if (initialized) return;
  // extractable:true so we can export the public JWK for /jwks.json.
  const pair = await generateKeyPair(ALG, { extractable: true });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  kid = randomUUID();
  publicJwk = { ...(await exportJWK(publicKey)), kid, alg: ALG, use: "sig" };
  initialized = true;
}

export function keysReady(): boolean {
  return initialized;
}

export function jwks(): { keys: JWK[] } {
  return { keys: [publicJwk] };
}

export interface SignOptions {
  aud: string;
  scope: string;
  // Test-only overrides so the reference client can forge bad tokens (SCEN-A4).
  expSeconds?: number; // default ~600s; negative => already expired
  signWith?: CryptoKey; // sign with a different (throwaway) key => bad signature
  iss?: string;
}

export async function signAccessToken(opts: SignOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expSeconds ?? 600);
  return await new SignJWT({ scope: opts.scope })
    .setProtectedHeader({ alg: ALG, kid })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(opts.signWith ?? privateKey);
}

export interface VerifyOptions {
  expectedAud: string;
  requiredScope: string;
}

export interface VerifiedToken {
  sub?: string;
  scope: string;
  aud: string;
}

// Verifies signature against the LOCAL public key, then iss / aud / exp / scope.
// Throws on any failure (caller maps to HTTP 401).
export async function verifyAccessToken(
  token: string,
  opts: VerifyOptions,
): Promise<VerifiedToken> {
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: opts.expectedAud,
    algorithms: [ALG],
    // jwtVerify enforces exp automatically.
  });

  const scope = typeof payload.scope === "string" ? payload.scope : "";
  const scopes = scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes(opts.requiredScope)) {
    throw new Error(`missing required scope "${opts.requiredScope}"`);
  }

  return {
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    scope,
    aud: opts.expectedAud,
  };
}

// Helper for SCEN-A4(a): generate a throwaway keypair to forge a bad-signature token.
export async function generateThrowawayPrivateKey(): Promise<CryptoKey> {
  const pair = await generateKeyPair(ALG, { extractable: true });
  return pair.privateKey;
}

export { importJWK };
