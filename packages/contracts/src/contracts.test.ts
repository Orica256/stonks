import { describe, expect, it } from "vitest";
import {
  Money,
  PlaceOrderCommand,
  AgentDecision,
  Instrument,
  InstrumentId,
  buildInstrumentId,
  parseInstrumentId,
  GetCorporateActionsRequest,
  BenchmarkComparisonResult,
  AgentObservation,
  BacktestResult,
} from "./index.js";

describe("Money schema", () => {
  it("accepts decimal strings, rejects floats/garbage", () => {
    expect(Money.safeParse({ amount: "100.50", currency: "JPY" }).success).toBe(
      true,
    );
    expect(Money.safeParse({ amount: 100.5, currency: "JPY" }).success).toBe(
      false,
    );
    expect(Money.safeParse({ amount: "1e3", currency: "USD" }).success).toBe(
      false,
    );
  });
});

describe("PlaceOrderCommand schema", () => {
  it("requires limitPrice for LIMIT orders", () => {
    const r = PlaceOrderCommand.safeParse({
      accountId: "a1",
      instrumentId: "i1",
      side: "BUY",
      type: "LIMIT",
      quantity: 100,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid MARKET order", () => {
    const r = PlaceOrderCommand.safeParse({
      accountId: "a1",
      instrumentId: "i1",
      side: "BUY",
      type: "MARKET",
      quantity: 100,
    });
    expect(r.success).toBe(true);
  });

  it("rejects STOP_LIMIT without stopPrice", () => {
    const r = PlaceOrderCommand.safeParse({
      accountId: "a1",
      instrumentId: "i1",
      side: "SELL",
      type: "STOP_LIMIT",
      quantity: 100,
      limitPrice: "1000",
    });
    expect(r.success).toBe(false);
  });
});

describe("AgentDecision schema (audit trail invariant)", () => {
  it("requires a non-empty rationale", () => {
    const base = {
      id: "d1",
      agentProfileId: "p1",
      accountId: "a1",
      ts: "2026-06-19T00:00:00Z",
      model: "claude-opus-4-8",
      inputContext: {},
      proposedActions: [{ kind: "HOLD" }],
    };
    expect(AgentDecision.safeParse({ ...base, rationale: "" }).success).toBe(
      false,
    );
    expect(
      AgentDecision.safeParse({ ...base, rationale: "uptrend" }).success,
    ).toBe(true);
  });
});

describe("InstrumentId canonical form (B1)", () => {
  it("accepts EXCHANGE:SYMBOL, rejects bare/unknown", () => {
    expect(InstrumentId.safeParse("TSE:7203").success).toBe(true);
    expect(InstrumentId.safeParse("NASDAQ:AAPL").success).toBe(true);
    expect(InstrumentId.safeParse("AAPL").success).toBe(false);
    expect(InstrumentId.safeParse("LSE:VOD").success).toBe(false);
  });

  it("build/parse round-trips and upper-cases the symbol", () => {
    expect(buildInstrumentId("NASDAQ", "aapl")).toBe("NASDAQ:AAPL");
    expect(parseInstrumentId("TSE:7203")).toEqual({
      exchange: "TSE",
      symbol: "7203",
    });
    expect(parseInstrumentId("nonsense")).toBeNull();
    expect(parseInstrumentId("LSE:VOD")).toBeNull();
  });
});

describe("GetCorporateActionsRequest schema (B12)", () => {
  it("accepts a valid request, rejects missing instrumentId", () => {
    expect(
      GetCorporateActionsRequest.safeParse({
        instrumentId: "TSE:7203",
        from: "2026-01-01T00:00:00Z",
        to: "2026-06-01T00:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      GetCorporateActionsRequest.safeParse({
        from: "2026-01-01T00:00:00Z",
        to: "2026-06-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("BenchmarkComparisonResult schema (benchmark unavailable reason)", () => {
  it("accepts the available case with a comparison", () => {
    const r = BenchmarkComparisonResult.safeParse({
      available: true,
      comparison: {
        accountId: "a1",
        benchmark: "BUY_AND_HOLD",
        range: { from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" },
        strategyReturn: 0.1,
        benchmarkReturn: 0.05,
        excessReturn: 0.05,
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts the unavailable case with a typed reason", () => {
    const r = BenchmarkComparisonResult.safeParse({
      available: false,
      benchmark: "SP500",
      reason: "NOT_CONFIGURED",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown reason", () => {
    const r = BenchmarkComparisonResult.safeParse({
      available: false,
      benchmark: "SP500",
      reason: "WHATEVER",
    });
    expect(r.success).toBe(false);
  });
});

describe("AgentObservation.cashByCurrency key tightening (型締め)", () => {
  const base = {
    accountId: "a1",
    asOf: "2026-06-19T00:00:00Z",
    positions: [],
    recentQuotes: [],
  };

  it("accepts a partial currency-keyed cash map (後方互換: JPY のみ)", () => {
    const r = AgentObservation.safeParse({
      ...base,
      cashByCurrency: { JPY: "500000" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty cash map", () => {
    const r = AgentObservation.safeParse({ ...base, cashByCurrency: {} });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown currency key", () => {
    const r = AgentObservation.safeParse({
      ...base,
      cashByCurrency: { EUR: "1" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-decimal cash value", () => {
    const r = AgentObservation.safeParse({
      ...base,
      cashByCurrency: { JPY: 500000 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative position quantity (Quantity 締め)", () => {
    const r = AgentObservation.safeParse({
      ...base,
      cashByCurrency: {},
      positions: [
        {
          instrumentId: "i1",
          symbol: "7203",
          quantity: -1,
          marketPrice: "100",
          unrealizedPnlPct: 0,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("BacktestResult.equityCurve ts tightening (型締め)", () => {
  const base = {
    metrics: {
      totalReturn: 0.1,
      maxDrawdown: 0.05,
      sharpe: 1,
      winRate: 0.5,
      trades: 3,
    },
  };

  it("accepts a UTC ISO8601 ts", () => {
    const r = BacktestResult.safeParse({
      ...base,
      equityCurve: [{ ts: "2026-01-01T00:00:00.000Z", equity: "1000000" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-timestamp ts string", () => {
    const r = BacktestResult.safeParse({
      ...base,
      equityCurve: [{ ts: "not-a-date", equity: "1000000" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("Instrument schema", () => {
  it("defaults tickRules and isActive", () => {
    const r = Instrument.parse({
      id: "TSE:7203",
      symbol: "7203",
      exchange: "TSE",
      market: "JP",
      name: "Toyota",
      currency: "JPY",
      type: "STOCK",
      lotSize: 100,
    });
    expect(r.tickRules).toEqual([]);
    expect(r.isActive).toBe(true);
  });

  it("keeps margin flags optional (未指定でも parse 成功・後方互換)", () => {
    const r = Instrument.parse({
      id: "TSE:7203",
      symbol: "7203",
      exchange: "TSE",
      market: "JP",
      name: "Toyota",
      currency: "JPY",
      type: "STOCK",
      lotSize: 100,
    });
    expect(r.marginTradable).toBeUndefined();
    expect(r.shortMarginable).toBeUndefined();
  });

  it("accepts explicit margin flags", () => {
    const r = Instrument.parse({
      id: "TSE:7203",
      symbol: "7203",
      exchange: "TSE",
      market: "JP",
      name: "Toyota",
      currency: "JPY",
      type: "STOCK",
      lotSize: 100,
      marginTradable: true,
      shortMarginable: false,
    });
    expect(r.marginTradable).toBe(true);
    expect(r.shortMarginable).toBe(false);
  });
});
