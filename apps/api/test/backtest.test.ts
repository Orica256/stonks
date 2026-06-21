import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { PriceBar } from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * バックテスト結線シナリオ（spec §6.5 / §6.8）:
 *   POST /backtests に StrategyDef + range + initialCash を渡し、
 *   market-data（フェイク）から供給したヒストリカルバーに対して
 *   trading-engine の約定で BacktestResult（損益・最大DD・シャープ）が出ることを検証。
 * 決定論的な小シナリオ（一貫した上昇トレンドで SMA クロス買い→上昇益）を使い、DB 無しで green。
 */
describe("apps/api backtest", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const instrument = makeInstrument(); // TSE:7203 / JPY / lot=100

  /** 連続する日足を生成する（ts 昇順、close 指定）。 */
  const makeBars = (closes: number[]): PriceBar[] =>
    closes.map((c, i) => {
      const ts = new Date(Date.UTC(2024, 0, 1 + i)).toISOString();
      return {
        instrumentId: instrument.id,
        timeframe: "1d",
        ts,
        open: String(c),
        high: String(c),
        low: String(c),
        close: String(c),
        volume: 1000,
      };
    });

  beforeAll(async () => {
    market = new FakeMarketData();
    market.setInstrument(instrument);
    // 単調増加トレンド: 安値で買い、高値で決済 → 実現益（winRate=1, trades=1）。
    market.setBars(
      instrument.id,
      makeBars([100, 101, 102, 104, 108, 113, 119, 126, 134, 143]),
    );

    const instruments = new InMemoryInstrumentProvider([instrument]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TOKENS.MarketData)
      .useValue(market)
      .overrideProvider(TOKENS.PriceProvider)
      .useValue(market)
      .overrideProvider(TOKENS.FxProvider)
      .useValue(market)
      .overrideProvider(TOKENS.InstrumentProvider)
      .useValue(instruments as InstrumentProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("runs a backtest and returns deterministic metrics + equity curve", async () => {
    const res = await request(app.getHttpServer())
      .post("/backtests")
      .send({
        strategy: {
          name: "sma-cross",
          universe: [instrument.id],
          timeframe: "1d",
          rules: [
            {
              when: "price < 105",
              action: "BUY",
              sizing: { mode: "FIXED_QTY", value: 100 },
            },
            {
              when: "price > 140",
              action: "CLOSE",
              sizing: { mode: "FIXED_QTY", value: 100 },
            },
          ],
        },
        range: {
          from: new Date(Date.UTC(2024, 0, 1)).toISOString(),
          to: new Date(Date.UTC(2024, 0, 31)).toISOString(),
        },
        initialCash: "1000000",
      })
      .expect(201);

    // メトリクスが揃って返る（数値で、トレードが発生している）。
    expect(res.body.metrics).toMatchObject({
      totalReturn: expect.any(Number),
      maxDrawdown: expect.any(Number),
      sharpe: expect.any(Number),
      winRate: expect.any(Number),
      trades: expect.any(Number),
    });
    // 安値で買い高値で決済 → 1 件の利益確定（winRate=1）。
    expect(res.body.metrics.trades).toBe(1);
    expect(res.body.metrics.winRate).toBe(1);
    // 取得より高値で決済したので総リターンはプラス。
    expect(res.body.metrics.totalReturn).toBeGreaterThan(0);

    // エクイティカーブは ts 昇順で Decimal 文字列の equity を持つ。
    expect(Array.isArray(res.body.equityCurve)).toBe(true);
    expect(res.body.equityCurve.length).toBeGreaterThan(0);
    for (const p of res.body.equityCurve) {
      expect(typeof p.ts).toBe("string");
      expect(typeof p.equity).toBe("string");
    }
  });

  it("rejects an invalid request body (zod validation)", async () => {
    const res = await request(app.getHttpServer())
      .post("/backtests")
      .send({ strategy: { name: "x" }, initialCash: "1000000" });
    // 不正な本文は RunBacktestRequest.parse で弾かれ、2xx にはならない。
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
