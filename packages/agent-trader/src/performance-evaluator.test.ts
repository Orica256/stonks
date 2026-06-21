import { describe, expect, it } from "vitest";
import type { EquityPoint, PortfolioSummary } from "@stonks/contracts";
import {
  BenchmarkUnavailableError,
  DefaultPerformanceEvaluator,
} from "./performance-evaluator.js";
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

  it("実現損益があれば勝率は trade 単位で計算する（B2）", async () => {
    // エクイティ変化の up 比率は 2/3 だが、realized は 3 件中 1 件のみ勝ち → 1/3。
    const portfolio = new FakePortfolioService({
      summary: summary("120"),
      history: points([100, 110, 90, 120]),
      realizedPnl: [
        {
          id: "r1",
          accountId: "acc",
          instrumentId: "i-1",
          quantity: 1,
          costBasis: "100",
          proceeds: "150",
          realized: "50",
          currency: "JPY",
          closedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        },
        {
          id: "r2",
          accountId: "acc",
          instrumentId: "i-1",
          quantity: 1,
          costBasis: "100",
          proceeds: "80",
          realized: "-20",
          currency: "JPY",
          closedAt: new Date(Date.UTC(2026, 0, 3)).toISOString(),
        },
        {
          id: "r3",
          accountId: "acc",
          instrumentId: "i-1",
          quantity: 1,
          costBasis: "100",
          proceeds: "90",
          realized: "-10",
          currency: "JPY",
          closedAt: new Date(Date.UTC(2026, 0, 4)).toISOString(),
        },
      ],
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({}),
    });
    const snap = await evaluator.snapshot("acc", new Date("2026-12-31T00:00:00Z"));
    expect(snap.winRate).toBeCloseTo(1 / 3, 10);
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

  it("指数ベンチ（TOPIX）も指数銘柄の価格系列で同様に比較する", async () => {
    // 戦略: 100 -> 90 (-10%)。指数: 2000 -> 2200 (+10%)。超過 = -0.2。
    const portfolio = new FakePortfolioService({
      summary: summary("90"),
      history: points([100, 90]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider(
        {},
        {
          "2026-01-01T00:00:00.000Z": {
            "topix-idx": { amount: "2000", currency: "JPY" },
          },
          "2026-01-02T00:00:00.000Z": {
            "topix-idx": { amount: "2200", currency: "JPY" },
          },
        },
      ),
      benchmark: { indexInstrumentId: { TOPIX: "topix-idx" } },
    });
    const cmp = await evaluator.compare("acc", "TOPIX", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-02T00:00:00Z"),
    });
    expect(cmp.strategyReturn).toBeCloseTo(-0.1, 10);
    expect(cmp.benchmarkReturn).toBeCloseTo(0.1, 10);
    expect(cmp.excessReturn).toBeCloseTo(-0.2, 10);
    expect(cmp.benchmark).toBe("TOPIX");
  });

  it("ベンチ銘柄が未設定なら NOT_CONFIGURED で明示的にエラー", async () => {
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
    await expect(
      evaluator.compare("acc", "TOPIX", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-02T00:00:00Z"),
      }),
    ).rejects.toMatchObject({
      name: "BenchmarkUnavailableError",
      reason: "NOT_CONFIGURED",
      benchmark: "TOPIX",
    });
  });

  it("ベンチ価格データが欠落していれば推測せず PRICE_DATA_MISSING で倒す", async () => {
    // 戦略エクイティ点は from/to にあるが、ベンチ銘柄の at 価格が未提供。
    const portfolio = new FakePortfolioService({
      summary: summary("130"),
      history: points([100, 130]),
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      // 時点別オーバーライドも固定価格も無い → getLatestPrice が throw。
      priceProvider: new FakePriceProvider({}),
      benchmark: { buyAndHoldInstrumentId: "bench-1" },
    });
    const err = await evaluator
      .compare("acc", "BUY_AND_HOLD", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-02T00:00:00Z"),
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchmarkUnavailableError);
    expect((err as BenchmarkUnavailableError).reason).toBe(
      "PRICE_DATA_MISSING",
    );
  });

  it("range 内の戦略エクイティ点が不足なら NO_STRATEGY_EQUITY（0 を捏造しない）", async () => {
    const portfolio = new FakePortfolioService({
      summary: summary("100"),
      history: points([100]), // 1 点のみ → 期間リターンを測れない。
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider(
        {},
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
    const err = await evaluator
      .compare("acc", "BUY_AND_HOLD", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-31T00:00:00Z"),
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BenchmarkUnavailableError);
    expect((err as BenchmarkUnavailableError).reason).toBe("NO_STRATEGY_EQUITY");
  });

  it("基準点を戦略の実エクイティ点に揃える（公正な同条件比較）", async () => {
    // 要求 range は 1/1〜1/31 だが、戦略のエクイティ点は 1/10 と 1/20 にしかない。
    // ベンチも *その同じ 2 時点* の価格で測る（range 端の値は使わない）。
    const history: EquityPoint[] = [
      { ts: new Date(Date.UTC(2026, 0, 10)).toISOString(), equity: "100" },
      { ts: new Date(Date.UTC(2026, 0, 20)).toISOString(), equity: "150" },
    ];
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio: new FakePortfolioService({ summary: summary("150"), history }),
      priceProvider: new FakePriceProvider(
        {},
        {
          // range 端（1/1, 1/31）にも値を置くが、これは使われてはならない。
          "2026-01-01T00:00:00.000Z": {
            "bench-1": { amount: "9999", currency: "JPY" },
          },
          "2026-01-31T00:00:00.000Z": {
            "bench-1": { amount: "1", currency: "JPY" },
          },
          // 実エクイティ点の時刻の価格: 200 -> 220 (+10%)。
          "2026-01-10T00:00:00.000Z": {
            "bench-1": { amount: "200", currency: "JPY" },
          },
          "2026-01-20T00:00:00.000Z": {
            "bench-1": { amount: "220", currency: "JPY" },
          },
        },
      ),
      benchmark: { buyAndHoldInstrumentId: "bench-1" },
    });
    const cmp = await evaluator.compare("acc", "BUY_AND_HOLD", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-31T00:00:00Z"),
    });
    // 戦略 +50%、ベンチ +10%（端点 9999/1 を使えば全く違う値になる）。
    expect(cmp.strategyReturn).toBeCloseTo(0.5, 10);
    expect(cmp.benchmarkReturn).toBeCloseTo(0.1, 10);
    expect(cmp.excessReturn).toBeCloseTo(0.4, 10);
    // 返す range は実際に用いた基準点。
    expect(cmp.range.from).toBe("2026-01-10T00:00:00.000Z");
    expect(cmp.range.to).toBe("2026-01-20T00:00:00.000Z");
  });

  it("評価時点（range.to）以降の価格を使わない（ルックアヘッド禁止）", async () => {
    // 終端を 1/20 に絞る。1/25 に高い価格があってもベンチに混入してはならない。
    const history: EquityPoint[] = [
      { ts: new Date(Date.UTC(2026, 0, 10)).toISOString(), equity: "100" },
      { ts: new Date(Date.UTC(2026, 0, 20)).toISOString(), equity: "110" },
      { ts: new Date(Date.UTC(2026, 0, 25)).toISOString(), equity: "999" },
    ];
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio: new FakePortfolioService({ summary: summary("110"), history }),
      priceProvider: new FakePriceProvider(
        {},
        {
          "2026-01-10T00:00:00.000Z": {
            "bench-1": { amount: "100", currency: "JPY" },
          },
          "2026-01-20T00:00:00.000Z": {
            "bench-1": { amount: "120", currency: "JPY" },
          },
          // 未来（1/25）の価格。使われたら benchmarkReturn が跳ねる。
          "2026-01-25T00:00:00.000Z": {
            "bench-1": { amount: "500", currency: "JPY" },
          },
        },
      ),
      benchmark: { buyAndHoldInstrumentId: "bench-1" },
    });
    const cmp = await evaluator.compare("acc", "BUY_AND_HOLD", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-20T00:00:00Z"), // 評価時点は 1/20。
    });
    // getHistory(range) が 1/25 を除外 → 終端は 1/20。ベンチも 1/20 まで。
    expect(cmp.range.to).toBe("2026-01-20T00:00:00.000Z");
    expect(cmp.strategyReturn).toBeCloseTo(0.1, 10);
    expect(cmp.benchmarkReturn).toBeCloseTo(0.2, 10);
  });
});
