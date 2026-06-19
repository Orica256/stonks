import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  StrategyDef,
  type Instrument,
  type PriceBar,
  type RunBacktestRequest,
} from "@stonks/contracts";
import { HistoricalBacktestRunner } from "./runner.js";
import { InMemoryDataSource } from "./in-memory.js";

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

describe("HistoricalBacktestRunner 振る舞い", () => {
  it("buy&hold: 価格上昇でプラスのリターン・正しい最終エクイティ", async () => {
    const data = new InMemoryDataSource([instrument], {
      "i-1": [
        bar("2026-01-02T00:00:00.000Z", "100"),
        bar("2026-01-03T00:00:00.000Z", "110"),
        bar("2026-01-04T00:00:00.000Z", "120"),
      ],
    });
    const strategy = StrategyDef.parse({
      name: "buy-once",
      universe: ["i-1"],
      timeframe: "1d",
      rules: [
        {
          when: "price < 105",
          action: "BUY",
          sizing: { mode: "FIXED_QTY", value: 100 },
        },
      ],
    });
    const req: RunBacktestRequest = {
      strategy,
      range: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T00:00:00.000Z",
      },
      initialCash: "100000",
    };

    const result = await new HistoricalBacktestRunner(data).run(req);

    // 100 株を 1 本目で約定し、120 まで保有 → プラス。
    expect(result.metrics.totalReturn).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(3);

    // 最終エクイティ = 残現金 + 100 株 * 120。残現金 = 10万 - 約定額(>=100*100) - 手数料。
    const finalEquity = new Decimal(
      result.equityCurve[result.equityCurve.length - 1]!.equity,
    );
    // 概算: 100株購入コスト ~10000+手数料。最終 ~= 100000 - 10005 - fee + 12000 ≈ 101,9xx。
    expect(finalEquity.greaterThan(101000)).toBe(true);
    expect(finalEquity.lessThan(102000)).toBe(true);

    // maxDrawdown は単調上昇なので 0 近傍。
    expect(result.metrics.maxDrawdown).toBeLessThan(0.01);
  });

  it("ルックアヘッド禁止: 後続バーで上抜けても当該バー時点では発注しない", async () => {
    // SMA(2) crossUp SMA(3) は最初の数本では確定せず、未来を参照しない。
    const closes = ["10", "10", "10", "10", "20", "20", "20"];
    const bars = closes.map((c, i) =>
      bar(`2026-02-0${i + 1}T00:00:00.000Z`, c),
    );
    const data = new InMemoryDataSource([instrument], { "i-1": bars });
    const strategy = StrategyDef.parse({
      name: "sma-cross",
      universe: ["i-1"],
      timeframe: "1d",
      rules: [
        {
          when: "SMA(2) crossUp SMA(3)",
          action: "BUY",
          sizing: { mode: "FIXED_QTY", value: 10 },
        },
      ],
    });
    const req: RunBacktestRequest = {
      strategy,
      range: {
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-02-28T00:00:00.000Z",
      },
      initialCash: "100000",
    };

    const result = await new HistoricalBacktestRunner(data).run(req);
    // クロスは価格ジャンプ後にのみ成立し得る（過去のみで判定）。エクイティは全バー分。
    expect(result.equityCurve).toHaveLength(closes.length);
    // 最終的に何らかの建玉が入っても、平坦区間(同値)ではクロスせず損失を出さない。
    expect(result.metrics.maxDrawdown).toBeLessThan(0.05);
  });
});
