import { describe, it, expect } from "vitest";
import { signSession, verifySession, signToken, verifyToken } from "@/lib/session";

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

describe("generic tokens", () => {
  it("round-trips a payload", () => {
    const t = signToken({ playerId: 7 }, "s");
    expect(verifyToken<{ playerId: number }>(t, "s")).toEqual({ playerId: 7 });
  });
  it("rejects wrong secret", () => {
    const t = signToken({ playerId: 7 }, "s");
    expect(verifyToken(t, "other")).toBeNull();
  });
  it("rejects tampered/garbage/undefined", () => {
    const t = signToken({ playerId: 7 }, "s");
    expect(verifyToken(t + "x", "s")).toBeNull();
    expect(verifyToken("garbage", "s")).toBeNull();
    expect(verifyToken(undefined, "s")).toBeNull();
  });
  it("rejects a payload swapped under a valid-looking token", () => {
    const forged = Buffer.from(JSON.stringify({ playerId: 99 })).toString("base64url");
    const t = signToken({ playerId: 7 }, "s");
    expect(verifyToken(`${forged}.${t.split(".")[1]}`, "s")).toBeNull();
  });
});
