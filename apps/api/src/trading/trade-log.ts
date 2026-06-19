import type { Trade } from "@stonks/contracts";
import type { PrismaClient } from "@stonks/db";

/**
 * 取引履歴（Trade）の参照口。contracts の PortfolioService は履歴 IF を持たないため、
 * GET /accounts/:id/trades 用に結線層で薄い記録/参照を用意する（ギャップ吸収）。
 */
export interface TradeLog {
  record(trade: Trade): Promise<void>;
  list(accountId: string): Promise<Trade[]>;
}

/** in-memory 実装（テスト・DB 無し運用）。 */
export class InMemoryTradeLog implements TradeLog {
  private readonly byAccount = new Map<string, Trade[]>();

  async record(trade: Trade): Promise<void> {
    const list = this.byAccount.get(trade.accountId) ?? [];
    list.push({ ...trade });
    this.byAccount.set(trade.accountId, list);
  }

  async list(accountId: string): Promise<Trade[]> {
    return [...(this.byAccount.get(accountId) ?? [])];
  }
}

/** Prisma 実装（本番）。Trade テーブルへ追記・参照する。 */
export class PrismaTradeLog implements TradeLog {
  constructor(private readonly db: PrismaClient) {}

  async record(trade: Trade): Promise<void> {
    await this.db.trade.create({
      data: {
        id: trade.id,
        orderId: trade.orderId,
        accountId: trade.accountId,
        instrumentId: trade.instrumentId,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee,
        currency: trade.currency,
        executedAt: new Date(trade.executedAt),
      },
    });
  }

  async list(accountId: string): Promise<Trade[]> {
    const rows = await this.db.trade.findMany({
      where: { accountId },
      orderBy: { executedAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      accountId: r.accountId,
      instrumentId: r.instrumentId,
      side: r.side,
      quantity: r.quantity,
      price: r.price.toString(),
      fee: r.fee.toString(),
      currency: r.currency,
      executedAt: r.executedAt.toISOString(),
    }));
  }
}
