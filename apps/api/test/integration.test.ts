import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * 結線の統合シナリオ（ローカル DB 無しで green）:
 *   銘柄検索 → 発注 → 評価 → 約定 → ポジション/サマリ反映 → 注文取消。
 * market-data はフェイク、リポジトリは各パッケージの in-memory 実装で結線する。
 */
describe("apps/api integration", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "acc-1";
  const instrument = makeInstrument(); // TSE:7203 / JPY / lot=100

  beforeAll(async () => {
    market = new FakeMarketData();
    market.setInstrument(instrument);
    market.setPrice(instrument.id, "2000");

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

    // 口座へ入金（PortfolioService の deposit で現金を供給。AccountStateProvider もこれを参照する）。
    const portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(accountId, { amount: "1000000", currency: "JPY" });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("searches instruments", async () => {
    const res = await request(app.getHttpServer())
      .get("/instruments")
      .query({ q: "toyota" })
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("TSE:7203");
  });

  it("returns a quote", async () => {
    const res = await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(instrument.id)}/quote`)
      .expect(200);
    expect(res.body.last).toBe("2000");
  });

  it("runs the full order → fill → position lifecycle", async () => {
    // 発注（成行買い 100 株）。
    const placed = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({ instrumentId: instrument.id, side: "BUY", type: "MARKET", quantity: 100 })
      .expect(201);
    expect(placed.body.status).toBe("PENDING");
    const orderId = placed.body.id as string;

    // 評価 → 約定生成（成行は即約定）。
    const evaluated = await request(app.getHttpServer())
      .post("/orders/evaluate")
      .expect(200);
    expect(evaluated.body.trades).toHaveLength(1);
    expect(evaluated.body.trades[0].orderId).toBe(orderId);

    // ポジションに反映される。
    const positions = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/positions`)
      .expect(200);
    expect(positions.body).toHaveLength(1);
    expect(positions.body[0].instrumentId).toBe(instrument.id);
    expect(positions.body[0].quantity).toBe(100);

    // 取引履歴に 1 件。
    const trades = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/trades`)
      .expect(200);
    expect(trades.body).toHaveLength(1);

    // サマリ: 現金は減り、ポジション評価額が立つ。
    const summary = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/summary`)
      .expect(200);
    expect(summary.body.baseCurrency).toBe("JPY");
    expect(Number(summary.body.positionsValue.amount)).toBeGreaterThan(0);
    expect(Number(summary.body.cash.amount)).toBeLessThan(1000000);
  });

  it("cancels an open order", async () => {
    const placed = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "100",
      })
      .expect(201);
    const orderId = placed.body.id as string;

    const cancelled = await request(app.getHttpServer())
      .delete(`/orders/${orderId}`)
      .expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");

    // 取消済みは再取消不可（ORDER_NOT_CANCELLABLE → 409）。
    await request(app.getHttpServer()).delete(`/orders/${orderId}`).expect(409);
  });

  it("computes indicators from bars", async () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({
      instrumentId: instrument.id,
      timeframe: "1d" as const,
      ts: new Date(2024, 0, i + 1).toISOString(),
      open: "100",
      high: "110",
      low: "90",
      close: String(100 + i),
      volume: 1000,
    }));
    market.setBars(instrument.id, bars);

    const res = await request(app.getHttpServer())
      .post(`/instruments/${encodeURIComponent(instrument.id)}/indicators`)
      .send({ timeframe: "1d", indicators: [{ kind: "SMA", params: { period: 3 } }] })
      .expect(201);
    expect(res.body.ts).toHaveLength(5);
    expect(res.body.series[0].name).toBe("SMA(3)");
  });

  it("rejects an oversized sell with 422", async () => {
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({ instrumentId: instrument.id, side: "SELL", type: "MARKET", quantity: 1000000 })
      .expect(422);
  });
});
