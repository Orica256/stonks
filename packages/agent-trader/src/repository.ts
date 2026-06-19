import type { AgentDecision, PerformanceSnapshot } from "@stonks/contracts";

/**
 * agent-trader の内部永続化 IF（依存性逆転）。
 *
 * 監査証跡（AgentDecision）と成績スナップショット（PerformanceSnapshot）を
 * 保存・参照する最小契約。`@stonks/db` を直接 import せず、この IF に対して実装する。
 * Phase 1 は in-memory 実装、実 DB 結線は api 側 Phase 2 で別実装を DI 差し替え（CLAUDE.md §4.3）。
 */
export interface AgentDecisionRepository {
  /** 意思決定ログ（監査証跡）を保存する。 */
  saveDecision(decision: AgentDecision): Promise<void>;
  /** 指定 decision を取得する（リプレイ・検証用）。 */
  getDecision(decisionId: string): Promise<AgentDecision | null>;
  /** 口座の意思決定ログを時系列昇順で返す。 */
  listDecisions(accountId: string): Promise<AgentDecision[]>;
}

/** 成績スナップショットの保存・参照 IF。 */
export interface PerformanceSnapshotRepository {
  /** スナップショットを追記する。 */
  appendSnapshot(snapshot: PerformanceSnapshot): Promise<void>;
  /** 口座のスナップショットを時系列昇順で返す。 */
  listSnapshots(accountId: string): Promise<PerformanceSnapshot[]>;
}
