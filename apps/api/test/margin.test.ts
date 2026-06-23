import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { DefaultPortfolioService } from "@stonks/portfolio";
import type { MarginPolicy, MarginPolicyProvider } from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * Phase 6 B（MarginPolicyProvider 配線）の結線シナリオ。
 *
 * 申し送り: これまで apps/api は MarginPolicyProvider を未配線で、MARGIN（信用）発注は
 * trading-engine 側で一律拒否されていた。本 Provider を配線したことで、
 *   1. MARGIN 発注が HTTP で受理される（従来 422 → 201）
 *   2. CASH（現物）発注は従来どおり（後方互換）
 *   3. MARGIN 約定が portfolio で CASH と別建玉に分離される
 *   4. 信用不可銘柄（provider が null）の MARGIN は拒否される
 * を担保する。market-data はフェイク、リポジトリは in-memory で結線（ローカル DB 無しで green）。
 */
describe("apps/api margin — MarginPolicyProvider wiring", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "acc-margin";
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

  it("accepts a MARGIN limit order (previously rejected when provider was unwired)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "2000",
        marginType: "MARGIN",
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    // MARGIN は明示的に order へ伝播する。
    expect(res.body.marginType).toBe("MARGIN");
  });

  it("accepts a MARGIN short (SELL) without requiring a held position", async () => {
    // 信用売り建ては現物の保有数量チェックを通さず保証金のみで判定される。
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "SELL",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "2000",
        marginType: "MARGIN",
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    expect(res.body.marginType).toBe("MARGIN");
  });

  it("keeps CASH (spot) ordering working as before (backward compatible)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "2000",
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    // CASH/未指定の現物は marginType を載せない（後方互換）。
    expect(res.body.marginType).toBeUndefined();
  });

  it("settles a MARGIN order into a position separated from the CASH holding", async () => {
    // 別口座で CASH 約定 → MARGIN 約定（同一銘柄・同方向）し、別建玉として観測する。
    const acc = "acc-margin-fill";
    const portfolio = app.get<DefaultPortfolioService>(TOKENS.PortfolioService);
    await portfolio.deposit(acc, { amount: "10000000", currency: "JPY" });

    // CASH 現物買い → 即時評価で約定。
    await request(app.getHttpServer())
      .post(`/accounts/${acc}/orders`)
      .send({ instrumentId: instrument.id, side: "BUY", type: "MARKET", quantity: 100 })
      .expect(201);
    await request(app.getHttpServer()).post("/orders/evaluate").expect(200);

    // MARGIN 信用買い → 評価で約定（provider 配線済みなので受理される）。
    await request(app.getHttpServer())
      .post(`/accounts/${acc}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "MARKET",
        quantity: 100,
        marginType: "MARGIN",
      })
      .expect(201);
    await request(app.getHttpServer()).post("/orders/evaluate").expect(200);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${acc}/positions`)
      .expect(200);

    // 同一 (account, instrument, side=LONG) でも CASH/MARGIN が別建玉として並ぶ。
    expect(res.body).toHaveLength(2);
    const margins = res.body
      .map((p: { marginType?: string }) => p.marginType ?? "CASH")
      .sort();
    expect(margins).toEqual(["CASH", "MARGIN"]);
  });
});

/**
 * 信用不可銘柄（MarginPolicyProvider が null を返す）のとき MARGIN 発注が拒否されること。
 * provider を「常に null」へ差し替え、CASH は通り MARGIN だけ 422 になるのを確認する。
 */
describe("apps/api margin — disallowed instrument (provider returns null)", () => {
  let app: INestApplication;
  const accountId = "acc-margin-disallowed";
  const instrument = makeInstrument();

  beforeAll(async () => {
    const market = new FakeMarketData();
    market.setInstrument(instrument);
    market.setPrice(instrument.id, "2000");
    const instruments = new InMemoryInstrumentProvider([instrument]);

    // 全銘柄を信用不可（null）にする MarginPolicyProvider。
    const nullPolicyProvider: MarginPolicyProvider = {
      async getMarginPolicy(): Promise<MarginPolicy | null> {
        return null;
      },
    };

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
      .overrideProvider(TOKENS.MarginPolicyProvider)
      .useValue(nullPolicyProvider)
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

  it("rejects a MARGIN order for a credit-disallowed instrument (400 VALIDATION)", async () => {
    // 信用不可は trading-engine が DomainError("VALIDATION") を投げる → 400。
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "2000",
        marginType: "MARGIN",
      })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("still accepts a CASH order for the same instrument", async () => {
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/orders`)
      .send({
        instrumentId: instrument.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 100,
        limitPrice: "2000",
      })
      .expect(201);
  });
});
