import { z } from "zod";
import { AgentAction, AgentObservation, Order } from "@stonks/contracts";
import type { ApiClient } from "./api-client.js";
import type { DecisionProvider } from "./decision-provider.js";

/**
 * 自律エージェントループの 1 反復（spec §2.7 P1）。
 *
 * 観測（GET /accounts/:id/observation）→ DecisionProvider で判断 → 発注上限で間引き →
 * rationale 付き AgentDecision を記録（POST /accounts/:id/agent-decisions）。
 * 発注の受理可否（金額/集中度/現金/enabled）は api 側の RiskGuard が AgentProfile に
 * 基づき強制するため、ここでは「暴走防止の二重防御」として enabled フラグと
 * 1 ループあたり発注上限のみを見る（spec §8/§9）。
 *
 * ドメインは直接 import せず、すべて ApiClient(HTTP) 経由（spec §4.3）。
 */

/** POST /accounts/:id/agent-decisions のレスポンス（contracts 形に準拠）。 */
const SubmitDecisionResult = z.object({
  decisionId: z.string(),
  orders: z.array(Order),
});
export type SubmitDecisionResult = z.infer<typeof SubmitDecisionResult>;

export type LoopOutcome =
  | { status: "disabled" }
  | { status: "skipped"; reason: string }
  | {
      status: "submitted";
      decisionId: string;
      orders: Order[];
      submittedActions: number;
      droppedActions: number;
    };

export interface RunLoopDeps {
  api: ApiClient;
  provider: DecisionProvider;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface RunLoopParams {
  accountId: string;
  agentProfileId: string;
  model: string;
  /** ループ有効フラグ。false なら観測も判断も発注も行わない（§9）。 */
  enabled: boolean;
  /** 1 ループあたりの最大発注（ORDER/CANCEL）数。HOLD は数えない。 */
  maxActionsPerLoop: number;
  strategyPrompt?: string;
}

/** ORDER/CANCEL のみを発注として数える（HOLD は副作用なし）。 */
const isOrderingAction = (a: z.infer<typeof AgentAction>): boolean =>
  a.kind === "ORDER" || a.kind === "CANCEL";

/**
 * 発注上限を尊重して提案アクションを間引く。
 *
 * ORDER/CANCEL は先頭から maxActionsPerLoop 件まで採用し、超過分は捨てる。
 * HOLD は上限に数えず保持する（監査上の意図を残すため）。
 */
export const capActions = (
  actions: z.infer<typeof AgentAction>[],
  maxActionsPerLoop: number,
): { kept: z.infer<typeof AgentAction>[]; dropped: number } => {
  const limit = Math.max(0, maxActionsPerLoop);
  const kept: z.infer<typeof AgentAction>[] = [];
  let ordering = 0;
  let dropped = 0;
  for (const a of actions) {
    if (isOrderingAction(a)) {
      if (ordering >= limit) {
        dropped += 1;
        continue;
      }
      ordering += 1;
    }
    kept.push(a);
  }
  return { kept, dropped };
};

/**
 * 自律ループ 1 反復を実行する。スケジューラ（BullMQ ジョブ）から呼ばれる純ロジック。
 * 実 Redis に依存せず、ApiClient と DecisionProvider のフェイクに対して単体テストできる。
 */
export const runAgentLoop = async (
  deps: RunLoopDeps,
  params: RunLoopParams,
): Promise<LoopOutcome> => {
  const log = deps.logger ?? console;

  // ── 暴走防止 1: enabled フラグ。無効なら何もしない（観測すら取りに行かない）。 ──
  if (!params.enabled) {
    log.info?.(`[agent-runner] loop disabled (account=${params.accountId})`);
    return { status: "disabled" };
  }
  if (!params.accountId || !params.agentProfileId) {
    log.warn?.(
      "[agent-runner] missing accountId/agentProfileId; skipping loop",
    );
    return { status: "skipped", reason: "missing accountId or agentProfileId" };
  }

  // ── 観測: 市況/保有/成績の要約を api から取得（ルックアヘッド無し・現時点情報）。 ──
  const rawObs = await deps.api.get(
    `/accounts/${encodeURIComponent(params.accountId)}/observation`,
  );
  const observation: AgentObservation = AgentObservation.parse(rawObs);

  // ── 判断: 注入された DecisionProvider（既定は無 LLM の HOLD）に委譲。 ──
  const decision = await deps.provider.decide({
    observation,
    model: params.model,
    ...(params.strategyPrompt !== undefined
      ? { strategyPrompt: params.strategyPrompt }
      : {}),
  });

  // rationale は監査証跡に必須。空なら発注せず破棄（spec §5.2 不変条件）。
  const rationale = decision.rationale?.trim();
  if (!rationale) {
    log.warn?.(
      "[agent-runner] decision had empty rationale; skipping (audit trail required)",
    );
    return { status: "skipped", reason: "empty rationale" };
  }

  // contracts スキーマで提案アクションを検証してから上限で間引く。
  const actions = z.array(AgentAction).parse(decision.actions);
  const { kept, dropped } = capActions(actions, params.maxActionsPerLoop);
  if (dropped > 0) {
    log.warn?.(
      `[agent-runner] dropped ${dropped} ordering action(s) over maxActionsPerLoop=${params.maxActionsPerLoop}`,
    );
  }

  // ── 記録 + 発注: 必ず rationale 付き AgentDecision を作る（HOLD のみでも記録する）。 ──
  // 発注の受理可否は api 側 RiskGuard が AgentProfile.riskLimits に基づき判定する。
  const raw = await deps.api.post(
    `/accounts/${encodeURIComponent(params.accountId)}/agent-decisions`,
    {
      agentProfileId: params.agentProfileId,
      rationale,
      actions: kept,
      inputContext: {
        source: "agent-runner",
        model: params.model,
        observation,
      },
    },
  );
  const result = SubmitDecisionResult.parse(raw);

  log.info?.(
    `[agent-runner] decision ${result.decisionId} recorded (orders=${result.orders.length}, actions=${kept.length})`,
  );

  return {
    status: "submitted",
    decisionId: result.decisionId,
    orders: result.orders,
    submittedActions: kept.filter(isOrderingAction).length,
    droppedActions: dropped,
  };
};
