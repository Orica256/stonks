import { z } from "zod";
import { Currency, DecimalString, Id, Timestamp } from "./common.js";

/** 口座の管理主体。個人ユーザーのみ（spec §2.6）だが口座単位で人間/AI を分離する。 */
export const ManagedBy = z.enum(["HUMAN", "AGENT"]);
export type ManagedBy = z.infer<typeof ManagedBy>;

export const Account = z.object({
  id: Id,
  name: z.string().min(1),
  baseCurrency: Currency, // 評価額の表示基軸
  managedBy: ManagedBy.default("HUMAN"),
  agentProfileId: Id.optional(), // AGENT 口座のみ
  createdAt: Timestamp,
});
export type Account = z.infer<typeof Account>;

/** 通貨別の現金残高（JPY/USD 両建て。spec §2.6）。 */
export const CashBalance = z.object({
  accountId: Id,
  currency: Currency,
  amount: DecimalString,
});
export type CashBalance = z.infer<typeof CashBalance>;
