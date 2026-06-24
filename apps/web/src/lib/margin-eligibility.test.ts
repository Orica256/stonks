import { describe, expect, it } from "vitest";
import type { Instrument } from "@stonks/contracts";
import { isMarginEligible } from "./margin-eligibility";

/**
 * 信用建て可否の純粋判定（spec §5.1）。
 * undefined（不明）は抑止しない＝undefined を返す、を保証する。
 */

function makeInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: "TSE:7203",
    symbol: "7203",
    exchange: "TSE",
    market: "JP",
    name: "トヨタ自動車",
    currency: "JPY",
    type: "STOCK",
    lotSize: 100,
    tickRules: [],
    isActive: true,
    ...overrides,
  };
}

describe("isMarginEligible", () => {
  it("instrument が null/undefined なら undefined（不明・抑止しない）", () => {
    expect(isMarginEligible(null, "BUY")).toBeUndefined();
    expect(isMarginEligible(undefined, "SELL")).toBeUndefined();
  });

  it("BUY は marginTradable を参照する", () => {
    expect(isMarginEligible(makeInstrument({ marginTradable: true }), "BUY")).toBe(
      true,
    );
    expect(
      isMarginEligible(makeInstrument({ marginTradable: false }), "BUY"),
    ).toBe(false);
  });

  it("SELL は shortMarginable を参照する", () => {
    expect(
      isMarginEligible(makeInstrument({ shortMarginable: true }), "SELL"),
    ).toBe(true);
    expect(
      isMarginEligible(makeInstrument({ shortMarginable: false }), "SELL"),
    ).toBe(false);
  });

  it("該当フラグ未指定（不明）なら undefined を返す", () => {
    const inst = makeInstrument({ marginTradable: true });
    // SELL 側の shortMarginable は未指定 → 不明。
    expect(isMarginEligible(inst, "SELL")).toBeUndefined();
    const inst2 = makeInstrument({ shortMarginable: false });
    // BUY 側の marginTradable は未指定 → 不明。
    expect(isMarginEligible(inst2, "BUY")).toBeUndefined();
  });
});
