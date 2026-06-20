import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Quantity,
  Timestamp,
} from "./common.js";

/** 入出金・配当・手数料・税・実現損益の台帳（spec §5.1 CashLedger）。 */
export const LedgerEntryType = z.enum([
  "DEPOSIT",
  "WITHDRAW",
  "FEE",
  "DIVIDEND",
  "TAX",
  "REALIZED_PNL",
  "TRADE", // 売買による現金移動
  "INTEREST", // 信用買い建ての金利（Phase 3。費用=負）
  "BORROW_FEE", // 信用売り建ての貸株料（Phase 3。費用=負）
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

export const CashLedgerEntry = z.object({
  id: Id,
  accountId: Id,
  type: LedgerEntryType,
  currency: Currency,
  amount: DecimalString, // 入金は正、出金は負
  refId: Id.optional(), // 関連する Trade / CorporateAction 等
  ts: Timestamp,
});
export type CashLedgerEntry = z.infer<typeof CashLedgerEntry>;

export const RealizedPnl = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  quantity: Quantity,
  costBasis: DecimalString,
  proceeds: DecimalString,
  realized: DecimalString,
  currency: Currency,
  closedAt: Timestamp,
});
export type RealizedPnl = z.infer<typeof RealizedPnl>;
