import { describe, expect, it } from "vitest";
import type { Instrument } from "@stonks/contracts";
import {
  currencyOfExchange,
  resolveInstrumentDisplay,
} from "./instrument-display";

/**
 * 銘柄表示ヘルパ（Phase 6）の単体テスト。
 * Instrument 解決済み/未解決（parseInstrumentId フォールバック）/不正形式の 3 経路と、
 * 取引所→通貨の導出を検証する。捏造をしない（名前を作らない）ことを確認する。
 */

function instrument(partial: Partial<Instrument>): Instrument {
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
    ...partial,
  };
}

describe("currencyOfExchange", () => {
  it("TSE は JPY、NYSE/NASDAQ は USD に導出する", () => {
    expect(currencyOfExchange("TSE")).toBe("JPY");
    expect(currencyOfExchange("NYSE")).toBe("USD");
    expect(currencyOfExchange("NASDAQ")).toBe("USD");
  });
});

describe("resolveInstrumentDisplay", () => {
  it("Instrument 解決済みなら symbol/name/exchange/currency をそのまま使う", () => {
    const d = resolveInstrumentDisplay(
      "TSE:7203",
      instrument({ id: "TSE:7203" }),
    );
    expect(d).toEqual({
      symbol: "7203",
      name: "トヨタ自動車",
      exchange: "TSE",
      currency: "JPY",
    });
  });

  it("未解決なら parseInstrumentId で symbol/exchange を得て通貨を導出する（name は作らない）", () => {
    const d = resolveInstrumentDisplay("NASDAQ:AAPL", undefined);
    expect(d).toEqual({
      symbol: "AAPL",
      name: undefined,
      exchange: "NASDAQ",
      currency: "USD",
    });
  });

  it("不正形式の id は生文字列を symbol にし通貨/取引所は undefined に縮退する", () => {
    const d = resolveInstrumentDisplay("garbage", undefined);
    expect(d).toEqual({
      symbol: "garbage",
      name: undefined,
      exchange: undefined,
      currency: undefined,
    });
  });
});
