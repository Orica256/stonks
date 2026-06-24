import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Quantity,
  Timestamp,
} from "./common.js";
import { MarginType } from "./margin.js";

/**
 * 税ロット管理（tax lot）の契約（spec §2.3 P2 / §5.1 TaxLot）。
 *
 * 取得ごとに 1 ロットを起こし、売却（クローズ）時にどのロットをどれだけ取り崩したかを
 * 明示することで、取得単価計算方式（特定/一般・FIFO 等）に基づく実現損益を再現する。
 * 実際の取り崩しロジック（ロット選択・按分）は portfolio の責務。ここは契約のみ。
 *
 * 金額は浮動小数を使わず DecimalString（CLAUDE.md §0）。時刻は UTC。
 */

/**
 * 口座区分（日本株の譲渡益課税の区分。spec §2.3「特定/一般」）。
 * - `SPECIFIC` : 特定口座。
 * - `GENERAL`  : 一般口座。
 * - `NISA`     : NISA（非課税。任意拡張）。
 */
export const TaxAccountType = z.enum(["SPECIFIC", "GENERAL", "NISA"]);
export type TaxAccountType = z.infer<typeof TaxAccountType>;

/**
 * 取得単価計算方式（spec §2.3「取得単価計算方式」）。
 * - `AVERAGE` : 総平均/移動平均（日本株の一般的方式。既定）。
 * - `FIFO`    : 先入先出。
 * - `LIFO`    : 後入先出。
 * - `SPECIFIC_LOT` : 売却ロットを明示指定。
 */
export const CostBasisMethod = z.enum([
  "AVERAGE",
  "FIFO",
  "LIFO",
  "SPECIFIC_LOT",
]);
export type CostBasisMethod = z.infer<typeof CostBasisMethod>;

/**
 * 税ロット 1 件（spec §5.1 TaxLot）。
 * 取得（買い建て/現物買い）ごとに 1 ロットを起こす。`remainingQuantity` を
 * 売却で取り崩し、0 になったロットはクローズ済みとなる。
 */
export const TaxLot = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  /** 取得時の数量。 */
  quantity: Quantity,
  /** 未決済（取り崩し可能）残数量。0 で完全クローズ。 */
  remainingQuantity: Quantity,
  /** 取得単価（1 株あたりの取得価額。手数料込みの取扱いは method に従う）。 */
  costBasis: DecimalString,
  currency: Currency,
  /** 取得日（UTC）。 */
  acquiredAt: Timestamp,
  /** 取得単価計算方式（既定 AVERAGE）。 */
  method: CostBasisMethod.default("AVERAGE"),
  /** 口座区分（特定/一般 等。既定 SPECIFIC）。 */
  taxAccountType: TaxAccountType.default("SPECIFIC"),
  /**
   * 資金区分。未指定=CASH 現物。CASH/MARGIN の税ロットを分離して取り崩すために使う。Phase 8。
   * （`.default()` ではなく optional にするのは、z.infer 出力型を必須化せず既存の手組み record /
   * 他フィールド（acquiredTradeId 等）の方針と揃えるため。読み手は `marginType ?? "CASH"` で解釈する。）
   */
  marginType: MarginType.optional(),
  /** ロットを生成した約定（取得元 Trade）。 */
  acquiredTradeId: Id.optional(),
});
export type TaxLot = z.infer<typeof TaxLot>;

/**
 * 1 回の売却（クローズ）で取り崩した税ロットの内訳 1 行。
 * RealizedPnl とロットの対応（どのロットをどれだけ取り崩したか）を表す。
 */
export const TaxLotConsumption = z.object({
  /** 取り崩した税ロット。 */
  taxLotId: Id,
  /** このロットから取り崩した数量。 */
  quantity: Quantity,
  /** 取り崩したロットの取得単価。 */
  costBasis: DecimalString,
});
export type TaxLotConsumption = z.infer<typeof TaxLotConsumption>;

/**
 * 税ロットを取り崩して算出した実現損益（RealizedPnl の税ロット拡張）。
 *
 * 既存 `RealizedPnl`（ledger.ts）に `lots`（取り崩し内訳）と `method` を付与した表示用
 * 拡張。既存 RealizedPnl は後方互換のためそのまま、これは税ロット由来の詳細が要る箇所で使う。
 */
export const RealizedPnlWithLots = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  quantity: Quantity,
  costBasis: DecimalString,
  proceeds: DecimalString,
  realized: DecimalString,
  currency: Currency,
  closedAt: Timestamp,
  /** クローズで取り崩したロットの内訳（method に基づく選択結果）。 */
  lots: z.array(TaxLotConsumption),
  /** 取得単価計算方式。 */
  method: CostBasisMethod,
  /** クローズ元の約定（売り Trade）。 */
  closedTradeId: Id.optional(),
});
export type RealizedPnlWithLots = z.infer<typeof RealizedPnlWithLots>;
