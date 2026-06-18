import { describe, expect, it } from "vitest";
import type { EquityPoint, PortfolioSummary } from "@stonks/contracts";
import { DefaultPerformanceEvaluator } from "./performance-evaluator.js";
import { InMemoryPerformanceSnapshotRepository } from "./in-memory-repository.js";
import { FakePortfolioService, FakePriceProvider } from "./fakes.js";

const summary = (equity: string): PortfolioSummary => ({
  accountId: "acc",
  baseCurrency: "JPY",
  cash: { amount: "0", currency: "JPY" },
  positionsValue: { amount: equity, currency: "JPY" },
  equity: { amount: equity, currency: "JPY" },
  unrealizedPnl: { amount: "0", currency: "JPY" },
  realizedPnl: { amount: "0", currency: "JPY" },
});

const points = (values: number[]): EquityPoint[] =>
  values.map((v, i) => ({
    ts: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    equity: String(v),
  }));

describe("PerformanceEvaluator.snapshot", () => {
  it("累積リターン・最大DD・勝率を計算する", async () => {
    const history = points([100, 110, 90, 120]);
    const portfolio = new FakePortfolioService({
      summary: summary("120"),
      history,
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
    });
    const snap = await evaluator.snapshot("acc", new Date("2026-12-31T00:00:00Z"));

    // 累積: 120/100 - 1 = 0.2
    expect(snap.cumulativeReturn).toBeCloseTo(0.2, 10);
    // 最大DD: ピーク110 -> 90 = (110-90)/110 ≈ 0.1818
    expect(snap.maxDrawdown).toBeCloseTo(20 / 110, 6);
    // 勝率: 期間リターン [+, -, +] のうち up は 2/3
    expect(snap.winRate).toBeCloseTo(2 / 3, 10);
    // 出力金額はサマリ由来。
    expect(snap.equity).toBe("120");
  });

  it("シャープは無リスク 0 で 年率換算 = mean/std * sqrt(periodsPerYear)", async () => {
    // 一定の +10% 連続 → std=0 → シャープ 0（ゼロ割回避）。
    const portfolio = new FakePortfolioService({
      summary: summary("121"),
      history: points([100, 110, 121]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
    });
    const snap = await evaluator.snapshot("acc", new Date("2026-12-31T00:00:00Z"));
    expect(snap.sharpe).toBe(0);
    expect(snap.winRate).toBe(1);
  });

  it("点が 1 つ以下なら指標は 0", async () => {
    const portfolio = new FakePortfolioService({
      summary: summary("100"),
      history: points([100]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
    });
    const snap = await evaluator.snapshot("acc", new Date("2026-12-31T00:00:00Z"));
    expect(snap.cumulativeReturn).toBe(0);
    expect(snap.maxDrawdown).toBe(0);
    expect(snap.sharpe).toBe(0);
    expect(snap.winRate).toBe(0);
  });

  it("snapshots IF を渡すと永続化する", async () => {
    const snaps = new InMemoryPerformanceSnapshotRepository();
    const portfolio = new FakePortfolioService({
      summary: summary("120"),
      history: points([100, 120]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
      snapshots: snaps,
    });
    await evaluator.snapshot("acc", new Date("2026-12-31T00:00:00Z"));
    expect(await snaps.listSnapshots("acc")).toHaveLength(1);
  });
});

describe("PerformanceEvaluator.compare", () => {
  it("BUY_AND_HOLD ベンチと超過リターンを計算する（同条件・手数料込みエクイティ）", async () => {
    // 戦略: 100 -> 130 (+30%)。ベンチ銘柄: 1000 -> 1100 (+10%)。
    const portfolio = new FakePortfolioService({
      summary: summary("130"),
      history: points([100, 130]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider(
        { "bench-1": { amount: "1100", currency: "JPY" } },
        {
          "2026-01-01T00:00:00.000Z": {
            "bench-1": { amount: "1000", currency: "JPY" },
          },
          "2026-01-02T00:00:00.000Z": {
            "bench-1": { amount: "1100", currency: "JPY" },
          },
        },
      ),
      benchmark: { buyAndHoldInstrumentId: "bench-1" },
    });
    const cmp = await evaluator.compare("acc", "BUY_AND_HOLD", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-02T00:00:00Z"),
    });
    expect(cmp.strategyReturn).toBeCloseTo(0.3, 10);
    expect(cmp.benchmarkReturn).toBeCloseTo(0.1, 10);
    expect(cmp.excessReturn).toBeCloseTo(0.2, 10);
    expect(cmp.benchmark).toBe("BUY_AND_HOLD");
  });

  it("ベンチ銘柄が未設定なら明示的にエラー", async () => {
    const portfolio = new FakePortfolioService({
      summary: summary("100"),
      history: points([100, 110]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
    });
    await expect(
      evaluator.compare("acc", "TOPIX", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-02T00:00:00Z"),
      }),
    ).rejects.toThrow(/benchmark instrument/);
  });
});
