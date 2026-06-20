import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  AgentAction,
  AgentProfile,
  BenchmarkId,
  type AgentDecision,
  type AgentObservation,
  type AgentTradingService,
  type BenchmarkComparison,
  type PerformanceEvaluator,
  type PerformanceSnapshot,
  type Order,
} from "@stonks/contracts";
import type { AgentDecisionRepository } from "@stonks/agent-trader";
import { TOKENS } from "../common/tokens.js";
import type { AgentProfileStore } from "./agent-profile-store.js";

/**
 * `POST /agents` のリクエスト本文。id / createdAt はサーバ採番のため受け取らない。
 * 形状は contracts.AgentProfile を唯一の真実とし、ここでは omit で派生するのみ
 * （手書き型と二重管理しない。CLAUDE.md §2）。
 */
const CreateAgentProfileBody = AgentProfile.omit({
  id: true,
  createdAt: true,
});

/**
 * `POST /accounts/:id/agent-decisions` のリクエスト本文。
 * accountId はパスを正準とするため本文では受け取らない。rationale は必須（監査証跡）。
 */
const SubmitDecisionBody = z.object({
  agentProfileId: z.string().min(1),
  rationale: z.string().min(1),
  actions: z.array(AgentAction),
  inputContext: z.unknown(),
});

/** performance の期間指定。range の名前付き窓 or 明示 from/to を受ける。 */
const RANGE_DAYS: Record<string, number | null> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  ytd: null, // 年初来
  all: null,
};

/** 名前付き range / from / to から評価窓 [from, to] を導出する。 */
const resolveRange = (
  range: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date,
): { from: Date; to: Date } => {
  const toDate = to ? new Date(to) : now;
  if (from) return { from: new Date(from), to: toDate };
  const key = (range ?? "1m").toLowerCase();
  if (key === "all") return { from: new Date(0), to: toDate };
  if (key === "ytd") {
    return {
      from: new Date(Date.UTC(toDate.getUTCFullYear(), 0, 1)),
      to: toDate,
    };
  }
  const days = RANGE_DAYS[key] ?? 30;
  return {
    from: new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000),
    to: toDate,
  };
};

/** Web Crypto があれば UUID、無ければ時刻+乱数（@types/node 非依存）。 */
const newId = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `agp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * AI エージェント取引・成績の REST エンドポイント（spec §6.8 / §2.7）:
 *   POST /agents                          AgentProfile 作成
 *   POST /accounts/:id/agent-decisions    AI 発注（rationale 必須 → AgentDecision + 発注委譲）
 *   GET  /accounts/:id/decisions          意思決定ログ閲覧（監査証跡）
 *   GET  /accounts/:id/performance?range=  成績スナップショット + ベンチ比較
 *
 * 発注・状態取得・評価はすべて agent-trader の AgentTradingService /
 * PerformanceEvaluator（contracts IF）へ委譲し、trading-engine / portfolio を
 * 直接呼ばない（spec §4.3 / §8）。
 */
@Controller()
export class AgentController {
  constructor(
    @Inject(TOKENS.AgentTradingService)
    private readonly agent: AgentTradingService,
    @Inject(TOKENS.PerformanceEvaluator)
    private readonly evaluator: PerformanceEvaluator,
    @Inject(TOKENS.AgentProfileStore)
    private readonly profiles: AgentProfileStore,
    @Inject(TOKENS.AgentDecisionRepository)
    private readonly decisions: AgentDecisionRepository,
  ) {}

  @Post("agents")
  async createAgent(@Body() body: unknown): Promise<AgentProfile> {
    const input = CreateAgentProfileBody.parse(body);
    const profile: AgentProfile = AgentProfile.parse({
      ...input,
      id: newId(),
      createdAt: new Date().toISOString(),
    });
    return this.profiles.create(profile);
  }

  @Post("accounts/:id/agent-decisions")
  async submitDecision(
    @Param("id") accountId: string,
    @Body() body: unknown,
  ): Promise<{ decisionId: string; orders: Order[] }> {
    const input = SubmitDecisionBody.parse(body);
    return this.agent.submitDecision({
      agentProfileId: input.agentProfileId,
      accountId,
      rationale: input.rationale,
      actions: input.actions,
      inputContext: input.inputContext,
    });
  }

  @Get("accounts/:id/decisions")
  decisions_(@Param("id") accountId: string): Promise<AgentDecision[]> {
    return this.decisions.listDecisions(accountId);
  }

  @Get("accounts/:id/observation")
  observation(@Param("id") accountId: string): Promise<AgentObservation> {
    return this.agent.buildObservation(accountId);
  }

  @Get("accounts/:id/performance")
  async performance(
    @Param("id") accountId: string,
    @Query("range") range?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("benchmark") benchmark?: string,
  ): Promise<{
    snapshot: PerformanceSnapshot;
    comparison: BenchmarkComparison | null;
  }> {
    const now = new Date();
    const window = resolveRange(range, from, to, now);

    // スナップショットは window.to 時点で評価（ルックアヘッド防止は評価器が担保）。
    const snapshot = await this.evaluator.snapshot(accountId, window.to);

    // ベンチ比較は要求時のみ。未設定ベンチは評価器が throw するため握って null に倒し、
    // スナップショットは常に返せるようにする。
    const benchId: BenchmarkId = benchmark
      ? BenchmarkId.parse(benchmark)
      : "BUY_AND_HOLD";
    let comparison: BenchmarkComparison | null = null;
    try {
      comparison = await this.evaluator.compare(accountId, benchId, window);
    } catch {
      comparison = null;
    }

    return { snapshot, comparison };
  }
}
