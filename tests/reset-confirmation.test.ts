import { describe, expect, it } from "vitest";
import { isResetConfirmation, RESET_CONFIRMATION } from "@/lib/resetConfirmation";

describe("reset confirmation", () => {
  it("requires the exact destructive phrase", () => {
    expect(isResetConfirmation(RESET_CONFIRMATION)).toBe(true);
    expect(isResetConfirmation("reset all game data")).toBe(false);
    expect(isResetConfirmation(`${RESET_CONFIRMATION} `)).toBe(false);
    expect(isResetConfirmation(undefined)).toBe(false);
  });
});
