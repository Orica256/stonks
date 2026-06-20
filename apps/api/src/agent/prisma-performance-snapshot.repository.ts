import type { PerformanceSnapshot } from "@stonks/contracts";
import type { PerformanceSnapshotRepository } from "@stonks/agent-trader";
import type { Prisma, PrismaClient } from "@stonks/db";

/**
 * agent-trader の PerformanceSnapshotRepository を Prisma で実装する（本番リポジトリ）。
 *
 * 成績スナップショット（spec §5.1）の時系列を追記・参照する。db 側は id を持つが
 * contracts.PerformanceSnapshot は (accountId, ts) を実質キーとするため id は採番に任せる。
 */
export class PrismaPerformanceSnapshotRepository
  implements PerformanceSnapshotRepository
{
  constructor(private readonly db: PrismaClient) {}

  async appendSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
    await this.db.performanceSnapshot.create({
      data: {
        accountId: snapshot.accountId,
        ts: new Date(snapshot.ts),
        equity: snapshot.equity,
        cash: snapshot.cash,
        positionsValue: snapshot.positionsValue,
        cumulativeReturn: snapshot.cumulativeReturn,
        maxDrawdown: snapshot.maxDrawdown,
        sharpe: snapshot.sharpe,
        winRate: snapshot.winRate,
      },
    });
  }

  async listSnapshots(accountId: string): Promise<PerformanceSnapshot[]> {
    const rows = await this.db.performanceSnapshot.findMany({
      where: { accountId },
      orderBy: { ts: "asc" },
    });
    return rows.map(toPerformanceSnapshot);
  }
}

/** Prisma の PerformanceSnapshot 行を contracts.PerformanceSnapshot に変換する。 */
const toPerformanceSnapshot = (
  row: Prisma.PerformanceSnapshotGetPayload<object>,
): PerformanceSnapshot => ({
  accountId: row.accountId,
  ts: row.ts.toISOString(),
  equity: row.equity.toString(),
  cash: row.cash.toString(),
  positionsValue: row.positionsValue.toString(),
  cumulativeReturn: row.cumulativeReturn,
  maxDrawdown: row.maxDrawdown,
  sharpe: row.sharpe,
  winRate: row.winRate,
});
