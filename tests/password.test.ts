import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("round-trips", () => {
    const stored = hashPassword("hunter22");
    expect(stored).toMatch(/^\$2[aby]\$12\$/);
    expect(verifyPassword("hunter22", stored)).toBe(true);
  });
  it("rejects wrong password", () => {
    expect(verifyPassword("nope", hashPassword("hunter22"))).toBe(false);
  });
  it("uses a fresh salt each time", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
