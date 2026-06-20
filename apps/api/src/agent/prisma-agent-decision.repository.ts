import type { AgentAction, AgentDecision } from "@stonks/contracts";
import type { AgentDecisionRepository } from "@stonks/agent-trader";
import type { Prisma, PrismaClient } from "@stonks/db";

/**
 * agent-trader の AgentDecisionRepository を Prisma で実装する（本番リポジトリ）。
 *
 * 監査証跡（spec §5.2）の永続化口。テストは agent-trader の InMemory 実装を使うため、
 * ここは typecheck で型整合を担保しつつ、id 衝突時は upsert で resultOrderIds の追記更新
 * （submitDecision は decision を 2 度 save する）を取りこぼさない。
 */
export class PrismaAgentDecisionRepository implements AgentDecisionRepository {
  constructor(private readonly db: PrismaClient) {}

  async saveDecision(decision: AgentDecision): Promise<void> {
    const data = {
      agentProfileId: decision.agentProfileId,
      accountId: decision.accountId,
      ts: new Date(decision.ts),
      model: decision.model,
      inputContext: (decision.inputContext ?? null) as Prisma.InputJsonValue,
      rationale: decision.rationale,
      proposedActions: decision.proposedActions as Prisma.InputJsonValue,
      resultOrderIds: decision.resultOrderIds,
    };
    await this.db.agentDecision.upsert({
      where: { id: decision.id },
      create: { id: decision.id, ...data },
      update: data,
    });
  }

  async getDecision(decisionId: string): Promise<AgentDecision | null> {
    const row = await this.db.agentDecision.findUnique({
      where: { id: decisionId },
    });
    return row ? toAgentDecision(row) : null;
  }

  async listDecisions(accountId: string): Promise<AgentDecision[]> {
    const rows = await this.db.agentDecision.findMany({
      where: { accountId },
      orderBy: { ts: "asc" },
    });
    return rows.map(toAgentDecision);
  }
}

/** Prisma の AgentDecision 行を contracts.AgentDecision に変換する。 */
const toAgentDecision = (
  row: Prisma.AgentDecisionGetPayload<object>,
): AgentDecision => ({
  id: row.id,
  agentProfileId: row.agentProfileId,
  accountId: row.accountId,
  ts: row.ts.toISOString(),
  model: row.model,
  inputContext: row.inputContext,
  rationale: row.rationale,
  proposedActions: (Array.isArray(row.proposedActions)
    ? row.proposedActions
    : []) as AgentAction[],
  resultOrderIds: row.resultOrderIds,
});
