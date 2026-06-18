import type { Prisma, PrismaClient } from "@stonks/db";
import type {
  CashBalance,
  CashLedgerEntry,
  Currency,
  EquityPoint,
  Instrument,
  Order,
  Position,
  RealizedPnl,
  TickRule,
} from "@stonks/contracts";

/**
 * Prisma 行 ⇄ contracts 型の変換。
 *
 * 金額は contracts では DecimalString、Prisma では Decimal なので `.toString()` で橋渡しする。
 * 時刻は contracts では ISO 文字列（UTC）、Prisma では DateTime。
 * 列挙（OrderSide 等）は db スキーマと contracts で名称が一致するためそのまま通す
 * （唯一 Timeframe のみ別名: db は m1/.../d1、contracts は 1m/.../1d）。
 */

export type PrismaTimeframe = "m1" | "m5" | "m15" | "h1" | "d1";

const TF_TO_DB: Record<string, PrismaTimeframe> = {
  "1m": "m1",
  "5m": "m5",
  "15m": "m15",
  "1h": "h1",
  "1d": "d1",
};

export const timeframeToDb = (tf: string): PrismaTimeframe => {
  const v = TF_TO_DB[tf];
  if (!v) throw new Error(`unknown timeframe: ${tf}`);
  return v;
};

/** Prisma の Instrument 行を contracts.Instrument に変換する。 */
export const toInstrument = (
  row: Prisma.InstrumentGetPayload<object>,
): Instrument => ({
  id: row.id,
  symbol: row.symbol,
  exchange: row.exchange,
  market: row.market,
  name: row.name,
  currency: row.currency,
  type: row.type,
  lotSize: row.lotSize,
  tickRules: (Array.isArray(row.tickRules) ? row.tickRules : []) as TickRule[],
  isActive: row.isActive,
});

/** Prisma の Order 行を contracts.Order に変換する。 */
export const toOrder = (row: Prisma.OrderGetPayload<object>): Order => ({
  id: row.id,
  accountId: row.accountId,
  instrumentId: row.instrumentId,
  side: row.side,
  type: row.type,
  quantity: row.quantity,
  filledQuantity: row.filledQuantity,
  ...(row.limitPrice != null ? { limitPrice: row.limitPrice.toString() } : {}),
  ...(row.stopPrice != null ? { stopPrice: row.stopPrice.toString() } : {}),
  timeInForce: row.timeInForce,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toPosition = (
  row: Prisma.PositionGetPayload<object>,
): Position => ({
  id: row.id,
  accountId: row.accountId,
  instrumentId: row.instrumentId,
  side: row.side,
  quantity: row.quantity,
  avgCost: row.avgCost.toString(),
  openedAt: row.openedAt.toISOString(),
});

export const toCashBalance = (
  row: Prisma.CashBalanceGetPayload<object>,
): CashBalance => ({
  accountId: row.accountId,
  currency: row.currency,
  amount: row.amount.toString(),
});

export const toLedgerEntry = (
  row: Prisma.CashLedgerEntryGetPayload<object>,
): CashLedgerEntry => ({
  id: row.id,
  accountId: row.accountId,
  type: row.type,
  currency: row.currency,
  amount: row.amount.toString(),
  ...(row.refId != null ? { refId: row.refId } : {}),
  ts: row.ts.toISOString(),
});

export const toRealizedPnl = (
  row: Prisma.RealizedPnlGetPayload<object>,
): RealizedPnl => ({
  id: row.id,
  accountId: row.accountId,
  instrumentId: row.instrumentId,
  quantity: row.quantity,
  costBasis: row.costBasis.toString(),
  proceeds: row.proceeds.toString(),
  realized: row.realized.toString(),
  currency: row.currency,
  closedAt: row.closedAt.toISOString(),
});

export const equityPointFromJson = (
  ts: string,
  equity: string,
): EquityPoint => ({ ts, equity });

export type Db = PrismaClient;
export type DbCurrency = Currency;
