import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Quantity,
  Timestamp,
} from "./common.js";

/**
 * 信用取引（margin）の契約（spec §2.2 P2 / §5.1 Position 信用拡張）。
 *
 * Phase 3 で trading-engine（margin 約定/金利）・portfolio（建玉評価）が実装する
 * 前提となる型・値オブジェクトを定義する。現物（CASH）の既存フローを壊さないよう、
 * すべて追加的・後方互換に保つ（marginType の既定は CASH）。
 *
 * 金額は浮動小数を使わず DecimalString（CLAUDE.md §0）。率は 0 以上の小数文字列。
 */

/**
 * 注文/建玉の資金区分。
 * - `CASH`   : 現物（既存フロー。既定値）。
 * - `MARGIN` : 信用（保証金を担保にロング/ショート建て。金利が発生する）。
 */
export const MarginType = z.enum(["CASH", "MARGIN"]);
export type MarginType = z.infer<typeof MarginType>;

/**
 * 率（rate）。年利・保証金率などを表す 0 以上の小数文字列（例 `"0.03"` = 3%）。
 * 浮動小数禁止のため DecimalString を負値非許可で締めたもの。
 */
export const Rate = DecimalString.refine(
  (v) => !v.startsWith("-"),
  "rate must be non-negative",
);
export type Rate = z.infer<typeof Rate>;

/**
 * 信用建ての保証金・金利パラメータ（市場/銘柄別の規定値。spec §2.2）。
 *
 * - `initialMarginRate`     : 必要保証金率（建玉時。例 JP 信用の 0.30）。
 * - `maintenanceMarginRate` : 維持保証金率（追証ライン。例 0.20）。
 * - `annualInterestRate`    : 買い建て金利（年利）。
 * - `annualBorrowRate`      : 売り建ての貸株料（年利。任意）。
 *
 * 実際の率は trading-engine の設定/規定値が供給する。ここは契約形のみを定める。
 */
export const MarginPolicy = z.object({
  initialMarginRate: Rate,
  maintenanceMarginRate: Rate,
  annualInterestRate: Rate,
  annualBorrowRate: Rate.optional(),
});
export type MarginPolicy = z.infer<typeof MarginPolicy>;

/**
 * 発注前の保証金チェック入力（trading-engine が現金/保証金充足を判定するための値）。
 * notional = 建玉の総代金。requiredMargin = notional × initialMarginRate。
 */
export const MarginRequirement = z.object({
  /** 建玉の総代金（数量 × 価格）。 */
  notional: DecimalString,
  /** 建玉に必要な保証金（= notional × initialMarginRate）。 */
  requiredMargin: DecimalString,
  /** 適用した必要保証金率。 */
  initialMarginRate: Rate,
  currency: Currency,
});
export type MarginRequirement = z.infer<typeof MarginRequirement>;

/**
 * 信用建玉に対する金利/貸株料の発生種別。
 * INTEREST = 買い建て金利、BORROW_FEE = 売り建て貸株料。
 */
export const InterestAccrualType = z.enum(["INTEREST", "BORROW_FEE"]);
export type InterestAccrualType = z.infer<typeof InterestAccrualType>;

/**
 * 信用建玉に対する金利/貸株料の発生記録（spec §5.1 CashLedger の INTEREST/BORROW_FEE）。
 *
 * 日次でアキュムレートし、CashLedgerEntry(INTEREST|BORROW_FEE) として現金へ反映する。
 * 実際のアキュムレート計算（日割り・建玉残高の追跡）は trading-engine / portfolio の責務。
 */
export const InterestAccrual = z.object({
  id: Id,
  accountId: Id,
  /** 対象の信用建玉。 */
  positionId: Id,
  instrumentId: Id,
  type: InterestAccrualType,
  /** 金利計算の基準額（建玉の総代金）。 */
  principal: DecimalString,
  /** 適用した年利。 */
  annualRate: Rate,
  /** 計上対象日数（日割り）。 */
  days: z.number().int().nonnegative(),
  /** 発生額（= principal × annualRate × days / 365）。費用として負の現金移動になる。 */
  amount: DecimalString,
  currency: Currency,
  /** 計上対象日（UTC）。 */
  accruedAt: Timestamp,
});
export type InterestAccrual = z.infer<typeof InterestAccrual>;

/**
 * 信用建玉に付随する margin 情報（Position の margin 拡張。spec §5.1）。
 * 現物（CASH）建玉はこのフィールドを持たない（undefined）。
 */
export const MarginInfo = z.object({
  /** 建玉時に拘束した保証金。 */
  postedMargin: DecimalString,
  /** 建玉時に適用した必要保証金率。 */
  initialMarginRate: Rate,
  /** 維持保証金率（追証判定に使う）。 */
  maintenanceMarginRate: Rate,
  /** 適用する年利（買い建て金利 or 売り建て貸株料）。 */
  annualRate: Rate,
  /** これまでに計上した金利/貸株料の累計（現金反映済み分）。 */
  accruedInterest: DecimalString.default("0"),
  /** 直近で金利を計上した時刻（次回アキュムレートの起点。UTC）。 */
  lastAccruedAt: Timestamp.optional(),
});
export type MarginInfo = z.infer<typeof MarginInfo>;

/** 保証金充足の判定結果（追証=margin call の有無）。 */
export const MarginCallStatus = z.object({
  accountId: Id,
  /** 維持に必要な保証金合計。 */
  requiredMaintenanceMargin: DecimalString,
  /** 現在の保証金余力（純資産）。 */
  equity: DecimalString,
  /** 追証発生中か（equity < requiredMaintenanceMargin）。 */
  marginCall: z.boolean(),
  currency: Currency,
});
export type MarginCallStatus = z.infer<typeof MarginCallStatus>;

/** 数量の別名（margin 計算の入力で参照されることがあるため再エクスポート）。 */
export const MarginQuantity = Quantity;
