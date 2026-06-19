import { describe, expect, it } from "vitest";
import {
  AgentDecision,
  AgentObservation,
  BenchmarkComparison,
  PerformanceSnapshot,
  type AgentProfile,
  type AgentTradingService,
  type PerformanceEvaluator,
  type PortfolioSummary,
  type RiskGuard,
} from "@stonks/contracts";
import { DefaultAgentTradingService } from "./agent-trading-service.js";
import { DefaultRiskGuard } from "./risk-guard.js";
import { DefaultPerformanceEvaluator } from "./performance-evaluator.js";
import {
  InMemoryAgentDecisionRepository,
  InMemoryPerformanceSnapshotRepository,
} from "./in-memory-repository.js";
import {
  FakeAgentProfileProvider,
  FakePortfolioService,
  FakePriceProvider,
  FakeTradingEngine,
} from "./fakes.js";
import Decimal from "decimal.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）。
 * 3 つの公開実装が contracts の IF 形状に一致し、出力が各 Zod スキーマに通ることを保証する。
 */

const NOW = new Date("2026-06-19T00:00:00.000Z");

const summary: PortfolioSummary = {
  accountId: "acc",
  baseCurrency: "JPY",
  cash: { amount: "1000000", currency: "JPY" },
  positionsValue: { amount: "0", currency: "JPY" },
  equity: { amount: "1000000", currency: "JPY" },
  unrealizedPnl: { amount: "0", currency: "JPY" },
  realizedPnl: { amount: "0", currency: "JPY" },
};

const profile: AgentProfile = {
  id: "p-1",
  name: "test",
  model: "claude-opus-4-8",
  mode: "MANUAL_MCP",
  riskLimits: {},
  enabled: true,
  createdAt: NOW.toISOString(),
};

describe("agent-trader 契約遵守", () => {
  it("DefaultAgentTradingService は AgentTradingService を実装する", () => {
    const svc: AgentTradingService = new DefaultAgentTradingService({
      profiles: new FakeAgentProfileProvider({ "p-1": profile }),
      portfolio: new FakePortfolioService({ summary }),
      priceProvider: new FakePriceProvider({
        "i-1": { amount: "1000", currency: "JPY" },
      }),
      tradingEngine: new FakeTradingEngine(),
      decisions: new InMemoryAgentDecisionRepository(),
      now: () => NOW,
    });
    expect(typeof svc.submitDecision).toBe("function");
    expect(typeof svc.buildObservation).toBe("function");
  });

  it("DefaultRiskGuard は RiskGuard を実装する", () => {
    const g: RiskGuard = new DefaultRiskGuard({
      limits: {},
      state: {
        notional: () => new Decimal(0),
        availableCash: () => new Decimal(0),
        positionPctAfter: () => 0,
        dailyNotionalSoFar: () => new Decimal(0),
      },
    });
    expect(typeof g.check).toBe("function");
    expect(g.check("acc", { kind: "HOLD" })).toEqual({ ok: true });
  });

  it("DefaultPerformanceEvaluator は PerformanceEvaluator を実装する", () => {
    const e: PerformanceEvaluator = new DefaultPerformanceEvaluator({
      portfolio: new FakePortfolioService({ summary }),
      priceProvider: new FakePriceProvider({}),
    });
    expect(typeof e.snapshot).toBe("function");
    expect(typeof e.compare).toBe("function");
  });

  it("出力は AgentDecision / AgentObservation スキーマに通る", async () => {
    const decisions = new InMemoryAgentDecisionRepository();
    const svc = new DefaultAgentTradingService({
      profiles: new FakeAgentProfileProvider({ "p-1": profile }),
      portfolio: new FakePortfolioService({ summary }),
      priceProvider: new FakePriceProvider({
        "i-1": { amount: "1000", currency: "JPY" },
      }),
      tradingEngine: new FakeTradingEngine(),
      decisions,
      now: () => NOW,
    });
    const res = await svc.submitDecision({
      agentProfileId: "p-1",
      accountId: "acc",
      rationale: "契約テスト用の打診買い",
      actions: [
        {
          kind: "ORDER",
          order: {
            accountId: "acc",
            instrumentId: "i-1",
            side: "BUY",
            type: "MARKET",
            quantity: 10,
            timeInForce: "DAY",
          },
        },
      ],
      inputContext: { note: "ctx" },
    });
    const stored = await decisions.getDecision(res.decisionId);
    expect(AgentDecision.parse(stored)).toBeTruthy();

    const obs = await svc.buildObservation("acc");
    expect(AgentObservation.parse(obs)).toBeTruthy();
  });

  it("出力は PerformanceSnapshot / BenchmarkComparison スキーマに通る", async () => {
    const portfolio = new FakePortfolioService({
      summary,
      history: [
        { ts: "2026-01-01T00:00:00.000Z", equity: "1000000" },
        { ts: "2026-02-01T00:00:00.000Z", equity: "1100000" },
      ],
    });
    const evaluator = new DefaultPerformanceEvaluator({
      portfolio,
      priceProvider: new FakePriceProvider({
        "bench-1": { amount: "1100", currency: "JPY" },
      }),
      benchmark: { buyAndHoldInstrumentId: "bench-1" },
      snapshots: new InMemoryPerformanceSnapshotRepository(),
    });
    const snap = await evaluator.snapshot("acc", NOW);
    expect(PerformanceSnapshot.parse(snap)).toBeTruthy();

    const cmp = await evaluator.compare("acc", "BUY_AND_HOLD", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
    });
    expect(BenchmarkComparison.parse(cmp)).toBeTruthy();
  });
});
