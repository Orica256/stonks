import type { AgentAction, AgentObservation } from "@stonks/contracts";

/**
 * LLM 判断の注入点（spec §2.7 P1）。
 *
 * 観測（市況/保有/成績の要約）を受け取り、根拠（rationale）と提案アクションを返す。
 * 実 LLM 実装は config（provider=llm）越しに差し替え可能にし、テストでは実 LLM・
 * 実ネットワークを使わないフェイク/決定的プロバイダに対して検証する（CLAUDE.md §3）。
 *
 * rationale は監査証跡（AgentDecision）に必須のため、実装は必ず非空文字列を返すこと
 * （空なら呼び出し側のループがガードして破棄する。spec §5.2 不変条件）。
 */
export interface DecisionProvider {
  decide(input: {
    observation: AgentObservation;
    model: string;
    /** エージェント戦略プロンプト（任意）。AgentProfile.strategyPrompt 由来。 */
    strategyPrompt?: string;
  }): Promise<DecisionResult>;
}

export interface DecisionResult {
  /** 判断の根拠（必須・非空）。 */
  rationale: string;
  /** 提案アクション（BUY/SELL=ORDER, CANCEL, HOLD）。空配列は「何もしない」。 */
  actions: AgentAction[];
}

/**
 * 無 LLM の安全既定プロバイダ。常に HOLD を返し、発注しない。
 *
 * 実 LLM・実ネットワーク・課金を一切伴わないため、既定値・テスト・ドライランに使う。
 * 自律ループの配線（観測→判断→記録）を LLM 無しで検証できる（CLAUDE.md §3）。
 */
export class HoldDecisionProvider implements DecisionProvider {
  async decide(input: {
    observation: AgentObservation;
    model: string;
    strategyPrompt?: string;
  }): Promise<DecisionResult> {
    return {
      rationale:
        "HoldDecisionProvider: no LLM configured; holding all positions (no trade).",
      actions: [{ kind: "HOLD", note: `asOf=${input.observation.asOf}` }],
    };
  }
}
