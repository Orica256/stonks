import { z } from "zod";
import { Currency, DateRange, DecimalString, Id } from "./common.js";
import { Rate } from "./margin.js";

/**
 * 譲渡益課税の「概算」契約（spec §2.3 P1「税計算（譲渡益課税の概算）」）。
 *
 * これは確定申告の正確な税額計算ではなく、シミュレーション上の **概算** である
 * （CLAUDE.md §7 の免責の範囲。投資助言ではない）。実現益（プラス分）に概算税率を
 * 掛けただけの目安であり、以下を含まない/簡略化している:
 *  - 損益通算（複数銘柄/期間の損失との相殺）。本概算では **益のみ** を対象とし、
 *    実現損失は税額 0 として扱う（控除・繰越控除は行わない）。
 *  - 譲渡費用・取得費の細目、配当との損益通算、各種特例・控除。
 *  - 口座区分（特定/一般/NISA）ごとの源泉徴収・非課税の精密な扱い。
 *    NISA 等の非課税は率 0 を渡すことで概算上は表現できるが、判定は呼び出し側の責務。
 *
 * 金額は浮動小数を使わず DecimalString（CLAUDE.md §0）。時刻は UTC。
 * 率は `Rate`（0 以上の小数文字列。例 "0.20315" = 20.315%）。
 */

/**
 * 日本株の申告分離課税（譲渡益課税）の既定の概算率 = 20.315%。
 * 内訳: 所得税 15% + 復興特別所得税 0.315% + 住民税 5%。
 *
 * これは **既定値** であり、口座区分や通貨で差し替え可能（例 US 口座、NISA 非課税）。
 * 実際にどの率を適用するかは portfolio / 設定の責務。`Rate`（DecimalString）として持つ。
 */
export const DEFAULT_CAPITAL_GAINS_TAX_RATE = "0.20315" as const;

/**
 * 期間内の譲渡益課税の概算（通貨別に 1 件）。
 *
 * `realizedGains` は対象期間にクローズした取引の実現益の合計（損失は概算では 0 床）。
 * `estimatedTax` = max(realizedGains, 0) × taxRate を概算した税額（常に 0 以上）。
 * RealizedPnl から計算で導出する（新規の永続テーブルは不要）。
 */
export const CapitalGainsTaxEstimate = z.object({
  accountId: Id,
  /** 集計対象期間（UTC）。 */
  range: DateRange,
  /** この概算が対象とする通貨（通貨別に 1 件返す想定）。 */
  currency: Currency,
  /**
   * 対象期間の実現益（課税対象。プラス分のみ）。
   * 損失は本概算では税額に反映しない（益のみ課税対象とみなす簡略方針）。
   */
  realizedGains: DecimalString,
  /** 適用した概算税率（既定 20.315% = DEFAULT_CAPITAL_GAINS_TAX_RATE）。 */
  taxRate: Rate,
  /** 概算税額（= max(realizedGains, 0) × taxRate。常に 0 以上）。 */
  estimatedTax: DecimalString,
});
export type CapitalGainsTaxEstimate = z.infer<typeof CapitalGainsTaxEstimate>;
