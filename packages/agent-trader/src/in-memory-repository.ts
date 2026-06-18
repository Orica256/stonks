import type { AgentDecision, PerformanceSnapshot } from "@stonks/contracts";
import type {
  AgentDecisionRepository,
  PerformanceSnapshotRepository,
} from "./repository.js";

const byTs = (a: { ts: string }, b: { ts: string }): number =>
  new Date(a.ts).getTime() - new Date(b.ts).getTime();

/** 保存・取得時の防御的ディープコピー（呼び出し側の変更で内部状態が壊れないように）。 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * AgentDecision / PerformanceSnapshot の in-memory 実装（Phase 1・テスト用）。
 * 実 DB 結線は Phase 2 で別実装を DI 差し替え（repository.ts の IF に準拠）。
 */
export class InMemoryAgentDecisionRepository
  implements AgentDecisionRepository
{
  private readonly decisions = new Map<string, AgentDecision>();

  async saveDecision(decision: AgentDecision): Promise<void> {
    this.decisions.set(decision.id, clone(decision));
  }

  async getDecision(decisionId: string): Promise<AgentDecision | null> {
    const d = this.decisions.get(decisionId);
    return d ? clone(d) : null;
  }

  async listDecisions(accountId: string): Promise<AgentDecision[]> {
    return [...this.decisions.values()]
      .filter((d) => d.accountId === accountId)
      .map((d) => clone(d))
      .sort(byTs);
  }
}

/** PerformanceSnapshot の in-memory 実装。 */
export class InMemoryPerformanceSnapshotRepository
  implements PerformanceSnapshotRepository
{
  private readonly snapshots = new Map<string, PerformanceSnapshot[]>();

  async appendSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
    const list = this.snapshots.get(snapshot.accountId) ?? [];
    list.push(clone(snapshot));
    this.snapshots.set(snapshot.accountId, list);
  }

  async listSnapshots(accountId: string): Promise<PerformanceSnapshot[]> {
    return [...(this.snapshots.get(accountId) ?? [])]
      .map((s) => clone(s))
      .sort(byTs);
  }
}
