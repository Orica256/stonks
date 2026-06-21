import { describe, expect, it } from "vitest";
import * as M from "./money.js";
import { isValidLot, roundToTick, tickSizeFor } from "./tick.js";
import { isMarketOpen } from "./market-calendar.js";
import {
  DEFAULT_CAPITAL_GAINS_TAX_RATE,
  estimateCapitalGainsTax,
} from "./tax.js";
import type { Instrument } from "@stonks/contracts";

describe("Money arithmetic (no float drift)", () => {
  it("adds decimals exactly", () => {
    const r = M.add(M.money("0.1", "JPY"), M.money("0.2", "JPY"));
    expect(r.amount).toBe("0.3"); // 0.1 + 0.2 が 0.30000...4 にならない
  });

  it("rejects currency mismatch", () => {
    expect(() => M.add(M.money("1", "JPY"), M.money("1", "USD"))).toThrow();
  });

  it("computes notional = price * qty", () => {
    expect(M.notional("1234.5", 100, "JPY").amount).toBe("123450");
  });
});

describe("tick size rules", () => {
  const rules = [
    { priceFrom: "0", tickSize: "1" },
    { priceFrom: "1000", tickSize: "5" },
    { priceFrom: "3000", tickSize: "10" },
  ];

  it("selects the band by price", () => {
    expect(tickSizeFor("500", rules)?.toString()).toBe("1");
    expect(tickSizeFor("1500", rules)?.toString()).toBe("5");
    expect(tickSizeFor("5000", rules)?.toString()).toBe("10");
  });

  it("rounds BUY down and SELL up to tick", () => {
    const inst = { tickRules: rules } as Pick<Instrument, "tickRules">;
    expect(roundToTick("1003", inst, "BUY")).toBe("1000");
    expect(roundToTick("1003", inst, "SELL")).toBe("1005");
  });
});

describe("lot validation", () => {
  it("requires multiples of lotSize", () => {
    expect(isValidLot(100, { lotSize: 100 })).toBe(true);
    expect(isValidLot(150, { lotSize: 100 })).toBe(false);
    expect(isValidLot(1, { lotSize: 1 })).toBe(true);
  });
});

describe("market calendar", () => {
  it("JP open at weekday noon JST, closed on weekend", () => {
    // 2026-06-19 is a Friday. 03:00 UTC = 12:00 JST.
    expect(isMarketOpen("JP", new Date("2026-06-19T03:00:00Z"))).toBe(true);
    // 2026-06-20 is Saturday.
    expect(isMarketOpen("JP", new Date("2026-06-20T03:00:00Z"))).toBe(false);
  });

  it("US open at weekday 10:00 ET", () => {
    // 2026-06-19 14:00 UTC = 10:00 EDT.
    expect(isMarketOpen("US", new Date("2026-06-19T14:00:00Z"))).toBe(true);
  });
});

describe("capital gains tax estimate (概算・浮動小数禁止)", () => {
  it("applies the default 20.315% rate to a gain", () => {
    expect(DEFAULT_CAPITAL_GAINS_TAX_RATE).toBe("0.20315");
    // 100000 × 0.20315 = 20315（浮動小数の誤差なく一致）。
    expect(estimateCapitalGainsTax("100000")).toBe("20315");
  });

  it("treats losses as zero tax (損失は税額に反映しない)", () => {
    expect(estimateCapitalGainsTax("-50000")).toBe("0");
    expect(estimateCapitalGainsTax("0")).toBe("0");
  });

  it("accepts a substituted rate (NISA 非課税 = 0)", () => {
    expect(estimateCapitalGainsTax("100000", "0")).toBe("0");
    expect(estimateCapitalGainsTax("100000", "0.15")).toBe("15000");
  });
});
