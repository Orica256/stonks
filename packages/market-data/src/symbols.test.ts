import { describe, expect, it } from "vitest";
import { DomainError } from "@stonks/contracts";
import {
  buildInstrumentId,
  fromYahooSymbol,
  parseInstrumentId,
  toFinnhubSymbol,
  toJQuantsCode,
  toYahooSymbol,
} from "./symbols.js";

describe("symbol normalization", () => {
  it("builds and parses EXCHANGE:SYMBOL ids", () => {
    expect(buildInstrumentId("TSE", "7203")).toBe("TSE:7203");
    expect(buildInstrumentId("NASDAQ", "aapl")).toBe("NASDAQ:AAPL");
    const jp = parseInstrumentId("TSE:7203");
    expect(jp).toEqual({
      exchange: "TSE",
      symbol: "7203",
      market: "JP",
      currency: "JPY",
    });
    const us = parseInstrumentId("NASDAQ:AAPL");
    expect(us.market).toBe("US");
    expect(us.currency).toBe("USD");
  });

  it("rejects malformed ids", () => {
    expect(() => parseInstrumentId("7203")).toThrow(DomainError);
    expect(() => parseInstrumentId("XSE:7203")).toThrow(DomainError);
    expect(() => parseInstrumentId("TSE:")).toThrow(DomainError);
  });

  it("maps to provider-specific tickers", () => {
    const jp = parseInstrumentId("TSE:7203");
    const us = parseInstrumentId("NASDAQ:AAPL");
    expect(toYahooSymbol(jp)).toBe("7203.T");
    expect(toYahooSymbol(us)).toBe("AAPL");
    expect(toFinnhubSymbol(jp)).toBe("7203.T");
    expect(toFinnhubSymbol(us)).toBe("AAPL");
    expect(toJQuantsCode(jp)).toBe("7203");
  });

  it("recovers instrumentId from yahoo symbols", () => {
    expect(fromYahooSymbol("7203.T", "TSE")).toBe("TSE:7203");
    expect(fromYahooSymbol("AAPL", "NASDAQ")).toBe("NASDAQ:AAPL");
  });
});
