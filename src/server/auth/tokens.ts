/**
 * The cryptographic primitives the Owner boundary is built from.
 *
 * They live together, and nowhere else, so that every secret in the sign-in
 * flow is generated the same way. The rule this module exists to enforce is
 * that a secret is created by `createToken()` and stored by `digestToken()` —
 * never a hand-rolled random string, never a raw secret written to a row.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 32 bytes. Chosen to match the session and `state` sizes in the decision
 * record, and because it is also the maximum a PKCE verifier may encode to
 * (43 base64url characters) — one size removes a class of "which length was
 * this one?" mistakes.
 */
const TOKEN_BYTES = 32;

/** A fresh secret, base64url encoded so it is safe in cookies and URLs alike. */
export function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What gets stored. Plain SHA-256 without a salt is correct here and would not
 * be for a password: these are 256-bit random values, so there is no dictionary
 * to attack and nothing for a salt to defend against. The property being bought
 * is that a stolen database row cannot be replayed as a credential.
 */
export function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The PKCE `S256` challenge for a verifier: base64url of its SHA-256. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Both sides are hashed to a fixed 32 bytes before comparison. That is not
 * about secrecy — it is because `timingSafeEqual` throws on length mismatch,
 * and an attacker-supplied value has an attacker-chosen length. Hashing first
 * makes every comparison the same shape, so length differences cannot be
 * probed through either an exception or a short-circuit.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** An ISO-8601 UTC instant, matching the format SQLite writes in migrations. */
export function timestamp(at: Date = new Date()): string {
  return at.toISOString().replace(/(\.\d{3})Z$/, "$1Z");
}

/** `at` shifted forward by `seconds`, as a stored timestamp. */
export function timestampAfter(seconds: number, at: Date = new Date()): string {
  return timestamp(new Date(at.getTime() + seconds * 1000));
}
