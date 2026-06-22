import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import type { Trade } from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * Phase 5（複合注文 OCO/IFD/bracket・CASH/MARGIN 建玉分離）の結線シナリオ。
 * market-data はフェイク、リポジトリは in-memory 実装で結線する（ローカル DB 無しで green）。
 */
describe("apps/api phase5 — compound orders & margin split", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "acc-p5";
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it("places an OCO compound order (2 linked orders, same linkGroupId)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders/bracket`)
      .send({
        kind: "OCO",
        legs: [
          {
            instrumentId: instrument.id,
            side: "BUY",
            type: "LIMIT",
            quantity: 100,
            limitPrice: "1800",
          },
          {
            instrumentId: instrument.id,
            side: "BUY",
            type: "STOP",
            quantity: 100,
            stopPrice: "2200",
          },
        ],
      })
      .expect(201);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const [a, b] = res.body;
    // 2 脚は共通 linkGroupId・linkType=OCO・両 ACTIVE。
    expect(a.linkGroupId).toBeDefined();
    expect(a.linkGroupId).toBe(b.linkGroupId);
    expect(a.linkType).toBe("OCO");
    expect(b.linkType).toBe("OCO");
    expect(a.activation).toBe("ACTIVE");
    expect(b.activation).toBe("ACTIVE");
    // accountId はパス正準で各脚へ注入される。
    expect(a.accountId).toBe(accountId);
  });

  it("places an IFD order (parent ACTIVE, child WAITING with parentOrderId)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders/bracket`)
      .send({
        kind: "IFD",
        parent: {
          instrumentId: instrument.id,
          side: "BUY",
          type: "LIMIT",
          quantity: 100,
          limitPrice: "1800",
        },
        children: [
          {
            instrumentId: instrument.id,
            side: "SELL",
            type: "LIMIT",
            quantity: 100,
            limitPrice: "2200",
          },
        ],
      })
      .expect(201);

    expect(res.body).toHaveLength(2);
    const [parent, child] = res.body;
    expect(parent.activation).toBe("ACTIVE");
    expect(child.activation).toBe("WAITING");
    expect(child.parentOrderId).toBe(parent.id);
    expect(child.linkType).toBe("IFD");
  });

  it("places a BRACKET (parent + 2 OCO children, all children WAITING)", async () => {
    const res = await request(app.getHttpServer())
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

    expect(res.body).toHaveLength(3);
    const [parent, c1, c2] = res.body;
    expect(parent.activation).toBe("ACTIVE");
    // 子 2 本は共通 linkGroupId(OCO)・共通 parentOrderId(親)・WAITING。
    expect(c1.linkGroupId).toBe(c2.linkGroupId);
    expect(c1.parentOrderId).toBe(parent.id);
    expect(c2.parentOrderId).toBe(parent.id);
    expect(c1.activation).toBe("WAITING");
    expect(c2.activation).toBe("WAITING");
  });

  it("cancels a whole order group via DELETE /orders/groups/:linkGroupId", async () => {
    // OCO を 1 つ建てる。
    const placed = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders/bracket`)
      .send({
        kind: "OCO",
        legs: [
          {
            instrumentId: instrument.id,
            side: "BUY",
            type: "LIMIT",
            quantity: 100,
            limitPrice: "1700",
          },
          {
            instrumentId: instrument.id,
            side: "BUY",
            type: "STOP",
            quantity: 100,
            stopPrice: "2400",
          },
        ],
      })
      .expect(201);
    const linkGroupId = placed.body[0].linkGroupId as string;

    const cancelled = await request(app.getHttpServer())
      .delete(`/orders/groups/${encodeURIComponent(linkGroupId)}`)
      .expect(200);

    expect(cancelled.body).toHaveLength(2);
    for (const o of cancelled.body) {
      expect(o.status).toBe("CANCELLED");
      expect(o.linkGroupId).toBe(linkGroupId);
    }
  });

  it("keeps CASH and MARGIN holdings as separate positions", async () => {
    // 別口座で CASH と MARGIN の同方向建玉を積み、別ポジションとして観測する。
    const marginAcc = "acc-p5-margin";
    const portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(marginAcc, { amount: "10000000", currency: "JPY" });

    const baseTrade = (over: Partial<Trade>): Trade => ({
      id: `t-${Math.random().toString(36).slice(2)}`,
      orderId: `o-${Math.random().toString(36).slice(2)}`,
      accountId: marginAcc,
      instrumentId: instrument.id,
      side: "BUY",
      quantity: 100,
      price: "2000",
      fee: "0",
      currency: "JPY",
      executedAt: new Date().toISOString(),
      ...over,
    });

    // 現物（CASH）建玉。
    await portfolio.applyTrade(baseTrade({ marginType: "CASH" }));
    // 信用（MARGIN）建玉（同一銘柄・同方向）。
    await portfolio.applyTrade(baseTrade({ marginType: "MARGIN" }));

    const res = await request(app.getHttpServer())
      .get(`/accounts/${marginAcc}/positions`)
      .expect(200);

    // 同一 (account, instrument, side=LONG) でも CASH/MARGIN が別建玉として並ぶ。
    expect(res.body).toHaveLength(2);
    const margins = res.body
      .map((p: { marginType?: string }) => p.marginType ?? "CASH")
      .sort();
    expect(margins).toEqual(["CASH", "MARGIN"]);
  });
});
