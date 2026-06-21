import type { AgentProfile } from "@stonks/contracts";
import type { AgentProfileProvider } from "@stonks/agent-trader";
import type { Prisma, PrismaClient } from "@stonks/db";

/**
 * AgentProfile の読み書き口（結線層）。
 *
 * agent-trader は読み取り専用の `AgentProfileProvider`（getProfile）にのみ依存するため、
 * `POST /agents` の作成側はこの結線層で補う（ギャップ吸収）。
 * RiskLimits/AgentProfile の形状そのものは contracts のスキーマが唯一の真実で、
 * ここでは再定義せず保存・取得の橋渡しのみ行う。
 */
export interface AgentProfileStore extends AgentProfileProvider {
  /** 完成済みの AgentProfile（id/createdAt 確定済み）を保存する。 */
  create(profile: AgentProfile): Promise<AgentProfile>;
  /** 登録済みの AgentProfile を一覧する（agent-runner がプロファイルを権威として取るため）。 */
  list(): Promise<AgentProfile[]>;
}

/** in-memory 実装（テスト・DB 無し運用）。 */
export class InMemoryAgentProfileStore implements AgentProfileStore {
  private readonly profiles = new Map<string, AgentProfile>();

  async create(profile: AgentProfile): Promise<AgentProfile> {
    this.profiles.set(profile.id, { ...profile });
    return { ...profile };
  }

  async getProfile(agentProfileId: string): Promise<AgentProfile | null> {
    const p = this.profiles.get(agentProfileId);
    return p ? { ...p } : null;
  }

  async list(): Promise<AgentProfile[]> {
    return [...this.profiles.values()].map((p) => ({ ...p }));
  }
}

/** Prisma 実装（本番）。AgentProfile テーブルへ追記・参照する。 */
export class PrismaAgentProfileStore implements AgentProfileStore {
  constructor(private readonly db: PrismaClient) {}

  async create(profile: AgentProfile): Promise<AgentProfile> {
    const row = await this.db.agentProfile.create({
      data: {
        id: profile.id,
        name: profile.name,
        model: profile.model,
        strategyPrompt: profile.strategyPrompt ?? null,
        mode: profile.mode,
        schedule: profile.schedule ?? null,
        riskLimits: profile.riskLimits as Prisma.InputJsonValue,
        enabled: profile.enabled,
        createdAt: new Date(profile.createdAt),
      },
    });
    return toAgentProfile(row);
  }

  async getProfile(agentProfileId: string): Promise<AgentProfile | null> {
    const row = await this.db.agentProfile.findUnique({
      where: { id: agentProfileId },
    });
    return row ? toAgentProfile(row) : null;
  }

  async list(): Promise<AgentProfile[]> {
    const rows = await this.db.agentProfile.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toAgentProfile);
  }
}

/** Prisma の AgentProfile 行を contracts.AgentProfile に変換する。 */
const toAgentProfile = (
  row: Prisma.AgentProfileGetPayload<object>,
): AgentProfile => ({
  id: row.id,
  name: row.name,
  model: row.model,
  ...(row.strategyPrompt != null ? { strategyPrompt: row.strategyPrompt } : {}),
  mode: row.mode,
  ...(row.schedule != null ? { schedule: row.schedule } : {}),
  riskLimits: (row.riskLimits ?? {}) as AgentProfile["riskLimits"],
  enabled: row.enabled,
  createdAt: row.createdAt.toISOString(),
});
