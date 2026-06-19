import { describe, expect, it } from "vitest";
import {
  BacktestResult,
  StrategyDef,
  type BacktestRunner,
  type Instrument,
  type PriceBar,
  type RunBacktestRequest,
} from "@stonks/contracts";
import { HistoricalBacktestRunner } from "./runner.js";
import { InMemoryDataSource } from "./in-memory.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）。
 * HistoricalBacktestRunner が contracts の BacktestRunner を実装し、
 * 出力が BacktestResult スキーマに通ることを保証する。
 */

const instrument: Instrument = {
  id: "i-1",
  symbol: "TEST",
  exchange: "NASDAQ",
  market: "US",
  name: "Test Co",
  currency: "USD",
  type: "STOCK",
  lotSize: 1,
  tickRules: [],
  isActive: true,
};

const bar = (ts: string, close: string): PriceBar => ({
  instrumentId: "i-1",
  timeframe: "1d",
  ts,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});

const buildRunner = (): {
  runner: HistoricalBacktestRunner;
  req: RunBacktestRequest;
} => {
  const data = new InMemoryDataSource([instrument], {
    "i-1": [
      bar("2026-01-02T00:00:00.000Z", "100"),
      bar("2026-01-03T00:00:00.000Z", "110"),
      bar("2026-01-04T00:00:00.000Z", "120"),
    ],
  });
  const strategy: StrategyDef = StrategyDef.parse({
    name: "buy-and-hold",
    universe: ["i-1"],
    timeframe: "1d",
    rules: [
      {
        when: "price < 105",
        action: "BUY",
        sizing: { mode: "FIXED_QTY", value: 10 },
      },
    ],
  });
  const req: RunBacktestRequest = {
    strategy,
    range: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" },
    initialCash: "100000",
  };
  return { runner: new HistoricalBacktestRunner(data), req };
};

describe("BacktestRunner 契約遵守", () => {
  it("HistoricalBacktestRunner は BacktestRunner を実装する", () => {
    const { runner } = buildRunner();
    const asRunner: BacktestRunner = runner;
    expect(typeof asRunner.run).toBe("function");
  });

  it("run の出力は BacktestResult スキーマに通る", async () => {
    const { runner, req } = buildRunner();
    const result = await runner.run(req);
    expect(BacktestResult.parse(result)).toBeTruthy();
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(typeof result.metrics.totalReturn).toBe("number");
    expect(typeof result.metrics.maxDrawdown).toBe("number");
    expect(typeof result.metrics.sharpe).toBe("number");
  });
});
