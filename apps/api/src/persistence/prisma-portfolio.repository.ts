import type {
  CashBalance,
  CashLedgerEntry,
  Currency,
  EquityPoint,
  Position,
  RealizedPnl,
  TaxLot,
  Trade,
} from "@stonks/contracts";
import type { PortfolioRepository } from "@stonks/portfolio";
import type { PrismaClient } from "@stonks/db";
import {
  toCashBalance,
  toLedgerEntry,
  toPosition,
  toRealizedPnl,
  toTrade,
} from "./mappers.js";

/**
 * portfolio の PortfolioRepository ポートを Prisma で実装する（本番リポジトリ）。
 *
 * - Position は (accountId, instrumentId, side=LONG) で一意。現物のみ扱う（信用は Phase 3）。
 * - EquityPoint は専用テーブルが無いため PerformanceSnapshot.equity に最小情報で保存する
 *   （cash/positionsValue 等は 0 詰め。完全な成績指標は agent-trader/Phase 3 で拡充）。
 * テストは portfolio の InMemoryPortfolioRepository を使い、ここは typecheck で型整合を担保する。
 */
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: PrismaClient) {}

  async getPosition(
    accountId: string,
    instrumentId: string,
  ): Promise<Position | undefined> {
    const row = await this.db.position.findUnique({
      where: {
        accountId_instrumentId_side: { accountId, instrumentId, side: "LONG" },
      },
    });
    return row ? toPosition(row) : undefined;
  }

  async listPositions(accountId: string): Promise<Position[]> {
    const rows = await this.db.position.findMany({ where: { accountId } });
    return rows.map(toPosition);
  }

  async savePosition(position: Position): Promise<void> {
    await this.db.position.upsert({
      where: {
        accountId_instrumentId_side: {
          accountId: position.accountId,
          instrumentId: position.instrumentId,
          side: "LONG",
        },
      },
      create: {
        id: position.id,
        accountId: position.accountId,
        instrumentId: position.instrumentId,
        side: "LONG",
        quantity: position.quantity,
        avgCost: position.avgCost,
        currency: position.currency,
        openedAt: new Date(position.openedAt),
      },
      update: {
        quantity: position.quantity,
        avgCost: position.avgCost,
        currency: position.currency,
      },
    });
  }

  async removePosition(accountId: string, instrumentId: string): Promise<void> {
    await this.db.position.deleteMany({
      where: { accountId, instrumentId, side: "LONG" },
    });
  }

  async getCashBalance(
    accountId: string,
    currency: Currency,
  ): Promise<CashBalance | undefined> {
    const row = await this.db.cashBalance.findUnique({
      where: { accountId_currency: { accountId, currency } },
    });
    return row ? toCashBalance(row) : undefined;
  }

  async listCashBalances(accountId: string): Promise<CashBalance[]> {
    const rows = await this.db.cashBalance.findMany({ where: { accountId } });
    return rows.map(toCashBalance);
  }

  async saveCashBalance(balance: CashBalance): Promise<void> {
    await this.db.cashBalance.upsert({
      where: {
        accountId_currency: {
          accountId: balance.accountId,
          currency: balance.currency,
        },
      },
      create: {
        accountId: balance.accountId,
        currency: balance.currency,
        amount: balance.amount,
      },
      update: { amount: balance.amount },
    });
  }

  async appendLedgerEntry(entry: CashLedgerEntry): Promise<void> {
    await this.db.cashLedgerEntry.create({
      data: {
        id: entry.id,
        accountId: entry.accountId,
        type: entry.type,
        currency: entry.currency,
        amount: entry.amount,
        refId: entry.refId ?? null,
        ts: new Date(entry.ts),
      },
    });
  }

  async listLedgerEntries(accountId: string): Promise<CashLedgerEntry[]> {
    const rows = await this.db.cashLedgerEntry.findMany({
      where: { accountId },
      orderBy: { ts: "asc" },
    });
    return rows.map(toLedgerEntry);
  }

  async appendRealizedPnl(entry: RealizedPnl): Promise<void> {
    await this.db.realizedPnl.create({
      data: {
        id: entry.id,
        accountId: entry.accountId,
        instrumentId: entry.instrumentId,
        quantity: entry.quantity,
        costBasis: entry.costBasis,
        proceeds: entry.proceeds,
        realized: entry.realized,
        currency: entry.currency,
        closedAt: new Date(entry.closedAt),
      },
    });
  }

  async listRealizedPnl(accountId: string): Promise<RealizedPnl[]> {
    const rows = await this.db.realizedPnl.findMany({
      where: { accountId },
      orderBy: { closedAt: "asc" },
    });
    return rows.map(toRealizedPnl);
  }

  async appendTrade(trade: Trade): Promise<void> {
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

  async listTrades(accountId: string): Promise<Trade[]> {
    const rows = await this.db.trade.findMany({
      where: { accountId },
      orderBy: { executedAt: "asc" },
    });
    return rows.map(toTrade);
  }

  async appendEquityPoint(
    accountId: string,
    point: EquityPoint,
  ): Promise<void> {
    await this.db.performanceSnapshot.create({
      data: {
        accountId,
        ts: new Date(point.ts),
        equity: point.equity,
        cash: "0",
        positionsValue: "0",
        cumulativeReturn: 0,
        maxDrawdown: 0,
        sharpe: 0,
        winRate: 0,
      },
    });
  }

  async listEquityPoints(accountId: string): Promise<EquityPoint[]> {
    const rows = await this.db.performanceSnapshot.findMany({
      where: { accountId },
      orderBy: { ts: "asc" },
    });
    return rows.map((r) => ({ ts: r.ts.toISOString(), equity: r.equity.toString() }));
  }

  // ── 税ロット（Phase 3。db の TaxLot テーブルへ永続化）──

  async appendTaxLot(lot: TaxLot): Promise<void> {
    await this.db.taxLot.create({ data: taxLotData(lot) });
  }

  async saveTaxLot(lot: TaxLot): Promise<void> {
    const data = taxLotData(lot);
    await this.db.taxLot.upsert({
      where: { id: lot.id },
      create: data,
      update: { remainingQuantity: lot.remainingQuantity },
    });
  }

  async listTaxLots(accountId: string, instrumentId?: string): Promise<TaxLot[]> {
    const rows = await this.db.taxLot.findMany({
      where: { accountId, ...(instrumentId !== undefined ? { instrumentId } : {}) },
      orderBy: { acquiredAt: "asc" },
    });
    return rows.map(toTaxLot);
  }
}

/** contracts.TaxLot → Prisma create/update data。 */
function taxLotData(lot: TaxLot) {
  return {
    id: lot.id,
    accountId: lot.accountId,
    instrumentId: lot.instrumentId,
    quantity: lot.quantity,
    remainingQuantity: lot.remainingQuantity,
    costBasis: lot.costBasis,
    currency: lot.currency,
    acquiredAt: new Date(lot.acquiredAt),
    method: lot.method,
    taxAccountType: lot.taxAccountType,
    ...(lot.acquiredTradeId !== undefined ? { acquiredTradeId: lot.acquiredTradeId } : {}),
  };
}

/** Prisma TaxLot 行 → contracts.TaxLot。 */
function toTaxLot(row: {
  id: string;
  accountId: string;
  instrumentId: string;
  quantity: number;
  remainingQuantity: number;
  costBasis: { toString(): string };
  currency: Currency;
  acquiredAt: Date;
  method: TaxLot["method"];
  taxAccountType: TaxLot["taxAccountType"];
  acquiredTradeId: string | null;
}): TaxLot {
  return {
    id: row.id,
    accountId: row.accountId,
    instrumentId: row.instrumentId,
    quantity: row.quantity,
    remainingQuantity: row.remainingQuantity,
    costBasis: row.costBasis.toString(),
    currency: row.currency,
    acquiredAt: row.acquiredAt.toISOString(),
    method: row.method,
    taxAccountType: row.taxAccountType,
    ...(row.acquiredTradeId !== null ? { acquiredTradeId: row.acquiredTradeId } : {}),
  };
}
