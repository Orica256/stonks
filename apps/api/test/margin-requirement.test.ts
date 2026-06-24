import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type {
  MarginPolicy,
  MarginPolicyProvider,
  MarginRequirement,
} from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * GET /instruments/:id/margin-requirement（必要保証金プレビュー。spec §6.8 / §2.2 P2）の結線シナリオ。
 *
 * 保証金計算は trading-engine の computeMarginRequirement に委譲し、api は銘柄解決・信用可否の
 * 事前抑止・最新価格の補完・ポリシー解決のみを担う。ローカル DB 無し（market-data フェイク／
 * in-memory InstrumentProvider）で green。
 *
 * 既定ポリシー（config）の initialMarginRate は "0.30"。
 */
describe("apps/api GET /instruments/:id/margin-requirement", () => {
  let app: INestApplication;
  // 信用可否フラグを明示した銘柄（true=可）と、未設定（不明）の銘柄を用意する。
  const ok = makeInstrument({
    id: "TSE:7203",
    marginTradable: true,
    shortMarginable: true,
  }); // JPY / lot=100
  const unknownFlags = makeInstrument({ id: "TSE:9999" }); // フラグ未設定（undefined）
  const noBuy = makeInstrument({ id: "TSE:1111", marginTradable: false });
  const noShort = makeInstrument({ id: "TSE:2222", shortMarginable: false });

  beforeAll(async () => {
    const market = new FakeMarketData();
    for (const i of [ok, unknownFlags, noBuy, noShort]) {
      market.setInstrument(i);
    }
    market.setPrice(ok.id, "2000");
    market.setPrice(unknownFlags.id, "3000");

    const instruments = new InMemoryInstrumentProvider([
      ok,
      unknownFlags,
      noBuy,
      noShort,
    ]);

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

  it("returns a MarginRequirement when policy exists (explicit price)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(ok.id)}/margin-requirement`)
      .query({ side: "BUY", quantity: 100, price: "2000" })
      .expect(200);
    const body = res.body as MarginRequirement;
    // notional = 2000 × 100 = 200000、requiredMargin = 200000 × 0.30 = 60000。
    expect(body.notional).toBe("200000");
    expect(body.requiredMargin).toBe("60000");
    expect(body.initialMarginRate).toBe("0.30");
    expect(body.currency).toBe("JPY");
  });

  it("uses the latest price when price is omitted", async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/instruments/${encodeURIComponent(unknownFlags.id)}/margin-requirement`,
      )
      .query({ side: "BUY", quantity: 10 })
      .expect(200);
    const body = res.body as MarginRequirement;
    // latest price = 3000、notional = 3000 × 10 = 30000、requiredMargin = 9000。
    expect(body.notional).toBe("30000");
    expect(body.requiredMargin).toBe("9000");
  });

  it("does not suppress when margin flags are unknown (undefined)", async () => {
    await request(app.getHttpServer())
      .get(
        `/instruments/${encodeURIComponent(unknownFlags.id)}/margin-requirement`,
      )
      .query({ side: "SELL", quantity: 10, price: "1000" })
      .expect(200);
  });

  it("returns 400 when margin buy is disallowed by instrument flag", async () => {
    const res = await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(noBuy.id)}/margin-requirement`)
      .query({ side: "BUY", quantity: 100, price: "2000" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("returns 400 when margin short is disallowed by instrument flag", async () => {
    await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(noShort.id)}/margin-requirement`)
      .query({ side: "SELL", quantity: 100, price: "2000" })
      .expect(400);
  });

  it("returns 400 when marginType=CASH (margin not required)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(ok.id)}/margin-requirement`)
      .query({ side: "BUY", quantity: 100, price: "2000", marginType: "CASH" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("returns 404 for an unknown instrument", async () => {
    await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent("TSE:0000")}/margin-requirement`)
      .query({ side: "BUY", quantity: 100, price: "2000" })
      .expect(404);
  });

  it("returns 400 for missing/invalid side and quantity", async () => {
    await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(ok.id)}/margin-requirement`)
      .query({ quantity: 100, price: "2000" })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(ok.id)}/margin-requirement`)
      .query({ side: "BUY", quantity: 0, price: "2000" })
      .expect(400);
  });
});

/**
 * 信用ポリシー未設定（MarginPolicyProvider が null を返す）のとき必要保証金プレビューが
 * 400 になること（＝信用不可）。provider を「常に null」へ差し替えて確認する。
 */
describe("apps/api margin-requirement — policy not configured (provider returns null)", () => {
  let app: INestApplication;
  const instrument = makeInstrument({ marginTradable: true });

  beforeAll(async () => {
    const market = new FakeMarketData();
    market.setInstrument(instrument);
    market.setPrice(instrument.id, "2000");
    const instruments = new InMemoryInstrumentProvider([instrument]);

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns 400 (VALIDATION) when no margin policy is configured", async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/instruments/${encodeURIComponent(instrument.id)}/margin-requirement`,
      )
      .query({ side: "BUY", quantity: 100, price: "2000" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });
});
