import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import { TaxLot, type Trade } from "@stonks/contracts";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * 税ロット一覧エンドポイント（GET /accounts/:id/tax-lots）の統合シナリオ（spec §2.3 P2 / §6.8。Phase 8.1）。
 * ローカル DB 無しで green: 入金 → CASH 現物買い 2 ロット → 一部売却で先頭ロットを完全クローズ、
 * さらに applyTrade で MARGIN 信用ロットを 1 件積む（marginType の往復を検証するため）。
 *
 * 検証:
 *  (a) ルートが契約型 TaxLot[] を返す。
 *  (b) open=true で未決済（remainingQuantity > 0）のみに絞られる。
 *  (c) MARGIN ロットの marginType が往復して返る（建玉別 CASH/MARGIN 内訳を web が表示できる）。
 * market-data はフェイク、リポジトリは in-memory。
 */
describe("apps/api GET /accounts/:id/tax-lots", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  let portfolio: DefaultPortfolioService;
  const accountId = "acc-tax-lots";
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

    portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(accountId, { amount: "1000000", currency: "JPY" });

    // CASH 現物で 2 ロット起こし（各 100株@1000）、100株を一部売却して
    // 先頭ロット（AVERAGE は FIFO 順で取り崩す）を remainingQuantity=0 にクローズする。
    await buy(100); // 税ロット A（remaining 100）
    await buy(100); // 税ロット B（remaining 100）
    await sell(100); // ロット A を完全クローズ（remaining 0）、ロット B は残る

    // MARGIN 信用ロットを 1 件積む（marginType が往復して返ることを検証するため）。
    // applyTrade は PortfolioService の公開 IF（信用約定で marginType=MARGIN の税ロットを起こす）。
    const marginTrade: Trade = {
      id: "trade-margin-1",
      orderId: "order-margin-1",
      accountId,
      instrumentId: instrument.id,
      side: "BUY",
      quantity: 100,
      price: "1200",
      fee: "0",
      currency: "JPY",
      marginType: "MARGIN",
      executedAt: new Date().toISOString(),
    };
    await portfolio.applyTrade(marginTrade);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns the contract-shaped TaxLot[] (all lots by default)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax-lots`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // CASH ロット A（クローズ済み）+ B（残）+ MARGIN ロットの 3 件。
    expect(res.body).toHaveLength(3);
    // 契約型 TaxLot をそのまま返す（形ズレ回避）。
    for (const lot of res.body) {
      expect(() => TaxLot.parse(lot)).not.toThrow();
      expect(lot.accountId).toBe(accountId);
      expect(lot.instrumentId).toBe(instrument.id);
    }
    // 既定（open 未指定）はクローズ済みロットも含む。
    expect(
      res.body.some((l: { remainingQuantity: number }) => l.remainingQuantity === 0),
    ).toBe(true);
  });

  it("filters to open (remainingQuantity > 0) lots with open=true", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax-lots`)
      .query({ open: "true" })
      .expect(200);

    // クローズ済みロット A を除いた CASH ロット B + MARGIN ロットの 2 件。
    expect(res.body).toHaveLength(2);
    for (const lot of res.body as { remainingQuantity: number }[]) {
      expect(lot.remainingQuantity).toBeGreaterThan(0);
    }
  });

  it("preserves marginType (CASH/MARGIN) so web can render the per-position breakdown", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/tax-lots`)
      .expect(200);

    const lots = res.body as { marginType?: string }[];
    // MARGIN ロットの marginType が往復して返る。
    expect(lots.some((l) => l.marginType === "MARGIN")).toBe(true);
    // CASH 現物ロットは marginType="CASH"（applyTrade 由来は明示 CASH を持つ）。
    expect(lots.filter((l) => l.marginType === "MARGIN")).toHaveLength(1);
  });
});
