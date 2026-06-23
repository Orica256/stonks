import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import type { Order } from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * GET /accounts/:id/orders（口座別注文一覧）の結線シナリオ（ローカル DB 無しで green）。
 * market-data はフェイク、リポジトリは in-memory 実装で結線する。
 */
describe("apps/api GET /accounts/:id/orders", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "acc-orders";
  const otherAccountId = "acc-orders-other";
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

    const portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(accountId, { amount: "10000000", currency: "JPY" });
    await portfolio.deposit(otherAccountId, {
      amount: "10000000",
      currency: "JPY",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns the account's orders newest-first (with status/activation/linkGroupId)", async () => {
    // 単発の指値注文を 2 本（先 → 後）。
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "1800",
      })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "1700",
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/orders`)
      .expect(200);

    const orders = res.body as Order[];
    expect(orders.length).toBeGreaterThanOrEqual(2);
    // 新しい順（後に出した注文が先頭側）。
    const head = orders[0];
    expect(head).toBeDefined();
    if (!head) throw new Error("expected at least one order");
    expect(head.id).toBe(second.body.id);
    // Order の主要フィールドが載る。
    expect(head.accountId).toBe(accountId);
    expect(head.instrumentId).toBe(instrument.id);
    expect(head.status).toBeDefined();
    // 単発注文は link 系/activation を省略（= ACTIVE・単発相当）。複合注文では明示される
    // （後段の bracket テストで linkGroupId/activation が載ることを検証する）。
  });

  it("does not mix in other accounts' orders (account isolation)", async () => {
    await request(app.getHttpServer())
      .post(`/accounts/${otherAccountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "1500",
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/orders`)
      .expect(200);
    const orders = res.body as Order[];
    for (const o of orders) {
      expect(o.accountId).toBe(accountId);
    }
  });

  it("includes compound (bracket) WAITING/ACTIVE orders in the list", async () => {
    const placed = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders/bracket`)
      .send({
        kind: "BRACKET",
        parent: {
          instrumentId: instrument.id,
          side: "BUY",
          type: "LIMIT",
          quantity: 100,
          limitPrice: "1900",
        },
        children: [
          {
            instrumentId: instrument.id,
            side: "SELL",
            type: "LIMIT",
            quantity: 100,
            limitPrice: "2300",
          },
          {
            instrumentId: instrument.id,
            side: "SELL",
            type: "STOP",
            quantity: 100,
            stopPrice: "1600",
          },
        ],
      })
      .expect(201);
    const linkGroupId = placed.body[1].linkGroupId as string;

    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/orders`)
      .expect(200);
    const orders = res.body as Order[];

    // bracket の子 2 本（WAITING・共通 linkGroupId）と親（ACTIVE）が一覧に出る。
    const group = orders.filter((o) => o.linkGroupId === linkGroupId);
    expect(group).toHaveLength(2);
    for (const o of group) {
      expect(o.activation).toBe("WAITING");
    }
    const parentId = placed.body[0].id as string;
    const parent = orders.find((o) => o.id === parentId);
    expect(parent?.activation).toBe("ACTIVE");
  });

  it("?open=true filters to open/waiting orders only", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/orders`)
      .query({ open: "true" })
      .expect(200);
    const orders = res.body as Order[];
    for (const o of orders) {
      const isOpen =
        o.activation === "WAITING" ||
        o.status === "PENDING" ||
        o.status === "PARTIALLY_FILLED";
      expect(isOpen).toBe(true);
    }
  });
});
