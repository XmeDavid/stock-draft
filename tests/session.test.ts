import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/session";

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const t = signSession("secret1");
    expect(verifySession(t, "secret1")).toBe(true);
  });
  it("rejects wrong secret", () => {
    const t = signSession("secret1");
    expect(verifySession(t, "other")).toBe(false);
  });
  it("rejects tampered/garbage/undefined", () => {
    expect(verifySession("garbage", "s")).toBe(false);
    expect(verifySession(undefined, "s")).toBe(false);
    const t = signSession("s");
    expect(verifySession(t + "x", "s")).toBe(false);
  });
});
