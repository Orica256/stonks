import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import {
  CapitalGainsTaxEstimate,
  DEFAULT_CAPITAL_GAINS_TAX_RATE,
} from "@stonks/contracts";
import { estimateCapitalGainsTax } from "@stonks/core-domain";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * 譲渡益課税の概算エンドポイント（GET /accounts/:id/tax）の統合シナリオ（spec §2.3 P1 / §6.8）。
 * ローカル DB 無しで green: 入金 → 約定で建玉 → 値上がり後に一部売却で実現益を作り、
 * GET /accounts/:id/tax が通貨別の概算税（既定率 20.315%）を返すことを検証する。
 * range 絞り込み（from/to）も確認する。market-data はフェイク、リポジトリは in-memory。
 */
describe("apps/api GET /accounts/:id/tax", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "acc-tax";
  const instrument = makeInstrument(); // TSE:7203 / JPY / lot=100

  /** 成行買い → 評価で約定（即時）。 */
  const buy = async (quantity: number): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({ instrumentId: instrument.id, side: "BUY", type: "MARKET", quantity })
      .expect(201);
    await request(app.getHttpServer()).post("/orders/evaluate").expect(200);
  };

  /** 成行売り → 評価で約定（即時）。 */
  const sell = async (quantity: number): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({ instrumentId: instrument.id, side: "SELL", type: "MARKET", quantity })
      .expect(201);
    await request(app.getHttpServer()).post("/orders/evaluate").expect(200);
  };

  beforeAll(async () => {
    market = new FakeMarketData();
    market.setInstrument(instrument);
    market.setPrice(instrument.id, "1000");

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

    const portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(accountId, { amount: "1000000", currency: "JPY" });

    // 200株@1000 で建玉を作り、値上がり後（@1500）に 100株を一部売却して実現益を作る。
    // 実現益 = (1500 - 1000) * 100 = 50000 JPY。
    await buy(200);
    market.setPrice(instrument.id, "1500");
    await sell(100);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns per-currency capital gains tax estimate at the default rate", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const jpy = res.body[0];
    // 契約型 CapitalGainsTaxEstimate をそのまま返す（形ズレ回避）。
    expect(() => CapitalGainsTaxEstimate.parse(jpy)).not.toThrow();
    expect(jpy.accountId).toBe(accountId);
    expect(jpy.currency).toBe("JPY");
    expect(jpy.taxRate).toBe(DEFAULT_CAPITAL_GAINS_TAX_RATE);
    // 一部売却で実現益（プラス）が立つ。手数料込みのため正確な値は約定モデル依存だが、
    // 既定率を掛けた概算税は core-domain の純関数と一致する（形ズレ・浮動小数なし）。
    expect(Number(jpy.realizedGains)).toBeGreaterThan(0);
    expect(jpy.estimatedTax).toBe(
      estimateCapitalGainsTax(jpy.realizedGains, DEFAULT_CAPITAL_GAINS_TAX_RATE),
    );
  });

  it("honors an explicit from/to range filter (excludes out-of-range realized pnl)", async () => {
    // 実現益は now（テスト実行時刻）に記録される。過去の閉区間で絞ると対象外になり空配列。
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax`)
      .query({ from: "2000-01-01T00:00:00.000Z", to: "2000-12-31T23:59:59.999Z" })
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it("includes the realized pnl when the range covers now", async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax`)
      .query({ from, to })
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(Number(res.body[0].realizedGains)).toBeGreaterThan(0);
    expect(res.body[0].estimatedTax).toBe(
      estimateCapitalGainsTax(
        res.body[0].realizedGains,
        DEFAULT_CAPITAL_GAINS_TAX_RATE,
      ),
    );
    // range はクエリの ISO 文字列に正規化される。
    expect(res.body[0].range.from).toBe(from);
    expect(res.body[0].range.to).toBe(to);
  });
});
