import { describe, expect, it } from "vitest";
import type {
  AgentAction,
  AgentProfile,
  PortfolioSummary,
} from "@stonks/contracts";
import { DefaultAgentTradingService } from "./agent-trading-service.js";
import { InMemoryAgentDecisionRepository } from "./in-memory-repository.js";
import {
  FakeAgentProfileProvider,
  FakePortfolioService,
  FakePriceProvider,
  FakeTradingEngine,
} from "./fakes.js";

const NOW = new Date("2026-06-19T00:00:00.000Z");

const summary = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  accountId: "acc",
  baseCurrency: "JPY",
  cash: { amount: "1000000", currency: "JPY" },
  positionsValue: { amount: "0", currency: "JPY" },
  equity: { amount: "1000000", currency: "JPY" },
  unrealizedPnl: { amount: "0", currency: "JPY" },
  realizedPnl: { amount: "0", currency: "JPY" },
  ...over,
});

const profile = (riskLimits: AgentProfile["riskLimits"] = {}): AgentProfile => ({
  id: "p-1",
  name: "test",
  model: "claude-opus-4-8",
  mode: "MANUAL_MCP",
  riskLimits,
  enabled: true,
  createdAt: NOW.toISOString(),
});

interface BuildOpts {
  profiles?: Record<string, AgentProfile>;
  summary?: PortfolioSummary;
  prices?: Record<string, { amount: string; currency: "JPY" | "USD" }>;
}

const build = (opts: BuildOpts = {}) => {
  const decisions = new InMemoryAgentDecisionRepository();
  const engine = new FakeTradingEngine();
  const portfolio = new FakePortfolioService({
    summary: opts.summary ?? summary(),
  });
  const svc = new DefaultAgentTradingService({
    profiles: new FakeAgentProfileProvider(
      opts.profiles ?? { "p-1": profile() },
    ),
    portfolio,
    priceProvider: new FakePriceProvider(
      opts.prices ?? { "i-1": { amount: "1000", currency: "JPY" } },
    ),
    tradingEngine: engine,
    decisions,
    now: () => NOW,
  });
  return { svc, decisions, engine, portfolio };
};

const orderAction = (over: Partial<{
  quantity: number;
  side: "BUY" | "SELL";
  instrumentId: string;
}> = {}): AgentAction => ({
  kind: "ORDER",
  order: {
    accountId: "acc",
    instrumentId: over.instrumentId ?? "i-1",
    side: over.side ?? "BUY",
    type: "MARKET",
    quantity: over.quantity ?? 10,
    timeInForce: "DAY",
  },
});

describe("AgentTradingService.submitDecision", () => {
  it("rationale 付き AgentDecision を必ず記録し、発注を resultOrderIds にひも付ける", async () => {
    const { svc, decisions, engine } = build();
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "RSI が売られ過ぎなので打診買い",
      actions: [orderAction({ quantity: 10 })],
      inputContext: { rsi: 25 },
    });

    expect(engine.placed).toHaveLength(1);
    expect(res.orders).toHaveLength(1);

    const stored = await decisions.getDecision(res.decisionId);
    expect(stored).not.toBeNull();
    expect(stored!.rationale).toBe("RSI が売られ過ぎなので打診買い");
    expect(stored!.model).toBe("claude-opus-4-8");
    expect(stored!.resultOrderIds).toEqual(res.orders.map((o) => o.id));
    // 監査証跡の欠落なし: 発注は decision にひも付く（spec §5.2）。
    expect(stored!.resultOrderIds).toHaveLength(1);
  });

  it("空 rationale は拒否し、発注も decision も作らない（監査証跡必須）", async () => {
    const { svc, engine, decisions } = build();
    await expect(
      svc.submitDecision({
        agentProfileId: "p-1",
        accountId: "acc",
        rationale: "   ",
        actions: [orderAction()],
        inputContext: {},
      }),
    ).rejects.toThrow(/rationale/);
    expect(engine.placed).toHaveLength(0);
    expect(await decisions.listDecisions("acc")).toHaveLength(0);
  });

  it("RiskGuard 違反のアクションは発注されないが decision は記録される", async () => {
    const { svc, engine, decisions } = build({
      profiles: { "p-1": profile({ maxOrderNotional: "5000" }) },
    });
    // 10株 × 1000 = 10000 > 5000 上限 → 拒否。
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "大きすぎる注文",
      actions: [orderAction({ quantity: 10 })],
      inputContext: {},
    });
    expect(engine.placed).toHaveLength(0);
    expect(res.orders).toHaveLength(0);
    const stored = await decisions.getDecision(res.decisionId);
    expect(stored).not.toBeNull();
    expect(stored!.proposedActions).toHaveLength(1);
    expect(stored!.resultOrderIds).toHaveLength(0);
  });

  it("enabled=false のエージェントは発注しないが decision は残す", async () => {
    const disabled = { ...profile(), enabled: false };
    const { svc, engine, decisions } = build({ profiles: { "p-1": disabled } });
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "停止中でも記録は残す",
      actions: [orderAction()],
      inputContext: {},
    });
    expect(engine.placed).toHaveLength(0);
    expect(res.orders).toHaveLength(0);
    expect(await decisions.getDecision(res.decisionId)).not.toBeNull();
  });

  it("通過分のみ発注し、違反分はスキップする（混在）", async () => {
    const { svc, engine } = build({
      profiles: { "p-1": profile({ maxOrderNotional: "12000" }) },
    });
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "1件は通り1件は超過",
      actions: [
        orderAction({ quantity: 10 }), // 10000 OK
        orderAction({ quantity: 20 }), // 20000 NG
        { kind: "HOLD", note: "様子見" },
      ],
      inputContext: {},
    });
    expect(engine.placed).toHaveLength(1);
    expect(res.orders).toHaveLength(1);
  });

  it("CANCEL アクションは TradingEngine.cancelOrder に委譲する", async () => {
    const { svc, engine } = build();
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "未約定をキャンセル",
      actions: [{ kind: "CANCEL", orderId: "o-99" }],
      inputContext: {},
    });
    expect(engine.cancelled).toEqual(["o-99"]);
    expect(res.orders).toHaveLength(1);
  });

  it("存在しない profile は拒否する", async () => {
    const { svc } = build();
    await expect(
      svc.submitDecision({
        agentProfileId: "missing",
        accountId: "acc",
        rationale: "x",
        actions: [],
        inputContext: {},
      }),
    ).rejects.toThrow(/profile not found/);
  });
});

describe("AgentTradingService.buildObservation", () => {
  it("保有・現金・時価から観測を組み立てる", async () => {
    const decisions = new InMemoryAgentDecisionRepository();
    const portfolio = new FakePortfolioService({
      summary: summary({
        cash: { amount: "500000", currency: "JPY" },
      }),
      positions: [
        {
          id: "pos-1",
          accountId: "acc",
          instrumentId: "i-1",
          side: "LONG",
          quantity: 100,
          avgCost: "900",
          currency: "JPY",
          openedAt: NOW.toISOString(),
          marketPrice: "1000",
          marketValue: { amount: "100000", currency: "JPY" },
          unrealizedPnl: { amount: "10000", currency: "JPY" },
          unrealizedPnlPct: 11.1,
        },
      ],
    });
    const svc = new DefaultAgentTradingService({
      profiles: new FakeAgentProfileProvider({ "p-1": profile() }),
      portfolio,
      priceProvider: new FakePriceProvider({
        "i-1": { amount: "1000", currency: "JPY" },
      }),
      tradingEngine: new FakeTradingEngine(),
      decisions,
      now: () => NOW,
    });
    const obs = await svc.buildObservation("acc");
    expect(obs.accountId).toBe("acc");
    expect(obs.cashByCurrency).toEqual({ JPY: "500000" });
    expect(obs.positions).toHaveLength(1);
    expect(obs.positions[0]!.instrumentId).toBe("i-1");
    // resolver 未注入時は symbol は instrumentId にフォールバック（B2）。
    expect(obs.positions[0]!.symbol).toBe("i-1");
    expect(obs.recentQuotes[0]!.last).toBe("1000");
  });

  it("InstrumentResolver があれば symbol を解決する（B2）", async () => {
    const portfolio = new FakePortfolioService({
      summary: summary({ cash: { amount: "500000", currency: "JPY" } }),
      positions: [
        {
          id: "pos-1",
          accountId: "acc",
          instrumentId: "TSE:7203",
          side: "LONG",
          quantity: 100,
          avgCost: "900",
          currency: "JPY",
          openedAt: NOW.toISOString(),
          marketPrice: "1000",
          marketValue: { amount: "100000", currency: "JPY" },
          unrealizedPnl: { amount: "10000", currency: "JPY" },
          unrealizedPnlPct: 11.1,
        },
      ],
    });
    const svc = new DefaultAgentTradingService({
      profiles: new FakeAgentProfileProvider({ "p-1": profile() }),
      portfolio,
      priceProvider: new FakePriceProvider({
        "TSE:7203": { amount: "1000", currency: "JPY" },
      }),
      tradingEngine: new FakeTradingEngine(),
      decisions: new InMemoryAgentDecisionRepository(),
      instruments: {
        async getById(id: string) {
          if (id !== "TSE:7203") return null;
          return {
            id: "TSE:7203",
            symbol: "7203",
            exchange: "TSE",
            market: "JP",
            name: "Toyota",
            currency: "JPY",
            type: "STOCK",
            lotSize: 100,
            tickRules: [],
            isActive: true,
          };
        },
      },
      now: () => NOW,
    });
    const obs = await svc.buildObservation("acc");
    expect(obs.positions[0]!.symbol).toBe("7203");
    expect(obs.recentQuotes[0]!.symbol).toBe("7203");
  });
});
