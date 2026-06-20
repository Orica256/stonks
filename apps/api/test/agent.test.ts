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
 * AI エージェント取引・成績エンドポイント（spec §6.8 / §2.7）の結線シナリオ:
 *   AgentProfile 作成 → rationale 付き発注 → 意思決定ログ（監査証跡）→ 成績スナップショット。
 * 不変条件（spec §5.2）「AGENT 口座の発注は必ず 1 件以上の AgentDecision に紐づく」を検証する。
 * DB 無しで green（in-memory フォールバック）。
 */
describe("apps/api agent trading", () => {
  let app: INestApplication;
  let market: FakeMarketData;
  const accountId = "agent-acc-1";
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
    await portfolio.deposit(accountId, { amount: "1000000", currency: "JPY" });
  });

  afterAll(async () => {
    await app?.close();
  });

  let profileId: string;

  it("creates an agent profile", async () => {
    const res = await request(app.getHttpServer())
      .post("/agents")
      .send({
        name: "test-strategy",
        model: "claude-opus-4-8",
        riskLimits: { maxOrderNotional: "500000" },
      })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("test-strategy");
    expect(res.body.mode).toBe("MANUAL_MCP");
    expect(res.body.enabled).toBe(true);
    profileId = res.body.id as string;
  });

  it("submits a rationale-backed decision and places the order", async () => {
    const res = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/agent-decisions`)
      .send({
        agentProfileId: profileId,
        rationale: "出来高増を伴う上抜けのため打診買い",
        inputContext: { note: "snapshot" },
        actions: [
          {
            kind: "ORDER",
            order: {
              accountId,
              instrumentId: instrument.id,
              side: "BUY",
              type: "MARKET",
              quantity: 100,
            },
          },
        ],
      })
      .expect(201);

    expect(res.body.decisionId).toBeTruthy();
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].accountId).toBe(accountId);
  });

  it("records the decision as an audit trail tied to the order (spec §5.2)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/decisions`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    const decision = res.body[0];
    expect(decision.rationale).toBe("出来高増を伴う上抜けのため打診買い");
    // 発注は必ず 1 件以上の resultOrderIds にひも付く（監査証跡の欠落を許さない）。
    expect(decision.resultOrderIds.length).toBeGreaterThanOrEqual(1);
  });

  it("returns a performance snapshot for the account", async () => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}/performance`)
      .query({ range: "1m" })
      .expect(200);

    expect(res.body.snapshot.accountId).toBe(accountId);
    expect(res.body.snapshot).toHaveProperty("equity");
    expect(res.body.snapshot).toHaveProperty("maxDrawdown");
    // ベンチ銘柄未設定のため比較は null に倒れる（スナップショットは常に返る）。
    expect(res.body.comparison).toBeNull();
  });
});
