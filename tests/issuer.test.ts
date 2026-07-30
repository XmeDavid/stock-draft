import { describe, expect, it } from "vitest";
import { findDraftedIssuer, issuerKey } from "@/lib/issuer";

describe("issuerKey", () => {
  it("groups international listings of the same equity", () => {
    expect(issuerKey({ symbol: "ASML", name: "ASML Holding N.V.", type: "equity" }))
      .toBe(issuerKey({ symbol: "ASML.AS", name: "ASML", type: "equity" }));
  });

  it("groups share classes of the same company", () => {
    expect(issuerKey({ symbol: "GOOG", name: "Alphabet Inc. Class C", type: "equity" }))
      .toBe(issuerKey({ symbol: "GOOGL", name: "Alphabet Inc. Class A", type: "equity" }));
  });

  it("does not group an ETF with its referenced company", () => {
    expect(issuerKey({ symbol: "ASML", name: "ASML Holding N.V.", type: "equity" }))
      .not.toBe(issuerKey({ symbol: "ASML.TO", name: "ASML CDR (CAD HEDGED)", type: "etf" }));
  });
});

describe("findDraftedIssuer", () => {
  it("finds a previously drafted alternate listing", () => {
    expect(findDraftedIssuer(
      { symbol: "GOOGL", name: "Alphabet Inc. Class A", type: "equity" },
      [{ symbol: "GOOG", name: "Alphabet Inc. Class C", type: "equity" }],
    )?.symbol).toBe("GOOG");
  });
});
