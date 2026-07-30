import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "race_admin";

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signSession(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ admin: true, iat: Date.now() })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
