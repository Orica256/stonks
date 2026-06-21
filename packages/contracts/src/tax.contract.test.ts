import { describe, expect, it } from "vitest";
import {
  CapitalGainsTaxEstimate,
  DEFAULT_CAPITAL_GAINS_TAX_RATE,
  Rate,
} from "./index.js";

describe("DEFAULT_CAPITAL_GAINS_TAX_RATE (申告分離課税の概算率)", () => {
  it("is 20.315% as a non-negative decimal string (no float)", () => {
    expect(DEFAULT_CAPITAL_GAINS_TAX_RATE).toBe("0.20315");
    // 既定率は Rate（0 以上の小数文字列）として妥当であること。
    expect(Rate.safeParse(DEFAULT_CAPITAL_GAINS_TAX_RATE).success).toBe(true);
  });
});

describe("CapitalGainsTaxEstimate (譲渡益課税の概算)", () => {
  const base = {
    accountId: "a1",
    range: {
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T23:59:59Z",
    },
    currency: "JPY" as const,
    realizedGains: "100000",
    taxRate: DEFAULT_CAPITAL_GAINS_TAX_RATE,
    estimatedTax: "20315",
  };

  it("accepts a well-formed estimate", () => {
    const r = CapitalGainsTaxEstimate.parse(base);
    expect(r.currency).toBe("JPY");
    expect(r.taxRate).toBe("0.20315");
    expect(r.estimatedTax).toBe("20315");
  });

  it("rejects float amounts (浮動小数禁止)", () => {
    expect(
      CapitalGainsTaxEstimate.safeParse({ ...base, realizedGains: 100000 })
        .success,
    ).toBe(false);
    expect(
      CapitalGainsTaxEstimate.safeParse({ ...base, estimatedTax: 20315.5 })
        .success,
    ).toBe(false);
  });

  it("rejects a negative tax rate", () => {
    expect(
      CapitalGainsTaxEstimate.safeParse({ ...base, taxRate: "-0.1" }).success,
    ).toBe(false);
  });

  it("allows a substituted rate (口座区分/通貨で差し替え可能)", () => {
    // NISA 等の非課税は率 0 で概算上表現できる。
    const nisa = CapitalGainsTaxEstimate.parse({
      ...base,
      taxRate: "0",
      estimatedTax: "0",
    });
    expect(nisa.estimatedTax).toBe("0");
  });

  it("requires from/to in the range (UTC timestamps)", () => {
    expect(
      CapitalGainsTaxEstimate.safeParse({
        ...base,
        range: { from: "not-a-date", to: base.range.to },
      }).success,
    ).toBe(false);
  });
});
