import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  InMemoryInstrumentProvider,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import type { Instrument } from "@stonks/contracts";
import { AppModule } from "../src/app.module.js";
import { DomainExceptionFilter } from "../src/common/domain-exception.filter.js";
import { TOKENS } from "../src/common/tokens.js";
import { FakeMarketData, makeInstrument } from "./fakes.js";

/**
 * GET /instruments/:id（単一銘柄取得）の結線シナリオ（ローカル DB 無しで green）。
 * web の一覧で instrumentId を銘柄名・通貨付きで表示するための補助ルート。
 * market-data はフェイク、InstrumentProvider は in-memory 実装で結線する。
 */
describe("apps/api GET /instruments/:id", () => {
  let app: INestApplication;
  const instrument = makeInstrument(); // TSE:7203 / JPY / lot=100

  beforeAll(async () => {
    const market = new FakeMarketData();
    market.setInstrument(instrument);

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

  it("returns the instrument (with symbol/currency/name) for a known id", async () => {
    const res = await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent(instrument.id)}`)
      .expect(200);
    const body = res.body as Instrument;
    expect(body.id).toBe(instrument.id);
    expect(body.symbol).toBe(instrument.symbol);
    expect(body.currency).toBe(instrument.currency);
    expect(body.name).toBe(instrument.name);
  });

  it("returns 404 for an unknown id", async () => {
    await request(app.getHttpServer())
      .get(`/instruments/${encodeURIComponent("TSE:0000")}`)
      .expect(404);
  });
});
