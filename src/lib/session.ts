import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "race_admin";

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Signs a JSON payload as `base64url(JSON).hmacHex`. */
export function signToken(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

/** Returns the payload if the signature matches, else null. */
export function verifyToken<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function signSession(secret: string): string {
  return signToken({ admin: true, iat: Date.now() }, secret);
}

export function verifySession(token: string | undefined, secret: string): boolean {
  return verifyToken<{ admin?: unknown }>(token, secret)?.admin === true;
}
