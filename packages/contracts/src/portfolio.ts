import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Money,
  Quantity,
  Timestamp,
} from "./common.js";
import type { Instrument } from "./instrument.js";
import type { CorporateAction } from "./market-data.js";
import type { RealizedPnl } from "./ledger.js";
import { MarginInfo, MarginType } from "./margin.js";
import type { CapitalGainsTaxEstimate } from "./tax.js";
import type { TaxLot } from "./tax-lot.js";
import type { Trade } from "./trade.js";

export const PositionSide = z.enum(["LONG", "SHORT"]);
export type PositionSide = z.infer<typeof PositionSide>;

/**
 * 建玉の論理一意キー（spec §5.1 への補記。Phase 5）。
 *
 * Phase 3 までは `[accountId, instrumentId, side]` を一意キーにしていたため、同一
 * (account, instrument, side) の **CASH 現物 LONG と MARGIN 信用 LONG を別行に持てなかった**。
 * Phase 5 でこれを `[accountId, instrumentId, side, marginType]` へ拡張し、現物と信用の
 * 同方向建玉を分離する（docs/contracts-backlog.md の未決事項を確定）。
 *
 * `Position.marginType` は型としては optional（既存コードが record を手組みする後方互換のため）
 * だが、**一意キー要素としては実質必須**: 未指定は CASH を意味し、永続層は Prisma
 * `@default(CASH)` で必ず値を持つ。すなわち一意性判定では `marginType ?? "CASH"` を用いる。
 * apps/api の upsert キーは `accountId_instrumentId_side` → `accountId_instrumentId_side_marginType`
 * へ変更が必要（後続 Wave。申し送り参照）。
 */
export const POSITION_UNIQUE_KEY = [
  "accountId",
  "instrumentId",
  "side",
  "marginType",
] as const;

export const Position = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  side: PositionSide.default("LONG"), // SHORT は信用（Phase 3）
  quantity: Quantity,
  avgCost: DecimalString, // 平均取得単価（建値）
  /** 建玉の取引通貨（B3: 自己記述的にし instrument→currency マップ回避を不要にする）。 */
  currency: Currency,
  /**
   * 資金区分（任意。未指定は CASH=現物として扱う。Phase 3）。
   * 現物建玉は未設定のまま既存挙動を保つ（永続層は Prisma `@default(CASH)`）。
   *
   * **Phase 5: 建玉一意キーの要素**。`[accountId, instrumentId, side, marginType]` で一意
   * （`POSITION_UNIQUE_KEY` 参照）。同一 (account, instrument, side) の CASH/MARGIN 建玉を
   * 別行に分離する。一意性判定では未指定を CASH とみなす（`marginType ?? "CASH"`）。
   */
  marginType: MarginType.optional(),
  /**
   * 信用建玉の保証金/金利情報（marginType === "MARGIN" のときのみ存在）。
   * 現物建玉は undefined（spec §5.1 Position 信用拡張）。
   */
  margin: MarginInfo.optional(),
  openedAt: Timestamp,
});
export type Position = z.infer<typeof Position>;

/** 評価額・含み損益を載せた表示用ビュー。 */
export const PositionView = Position.extend({
  marketPrice: DecimalString,
  marketValue: Money,
  unrealizedPnl: Money,
  unrealizedPnlPct: z.number(),
});
export type PositionView = z.infer<typeof PositionView>;

export const PortfolioSummary = z.object({
  accountId: Id,
  baseCurrency: Currency,
  cash: Money, // 基軸換算後の現金合計
  positionsValue: Money,
  equity: Money, // 総資産 = cash + positionsValue
  unrealizedPnl: Money,
  realizedPnl: Money,
});
export type PortfolioSummary = z.infer<typeof PortfolioSummary>;

export const EquityPoint = z.object({
  ts: Timestamp,
  equity: DecimalString,
});
export type EquityPoint = z.infer<typeof EquityPoint>;

/**
 * portfolio モジュールの公開契約（spec §6.3）。
 * 評価は PriceProvider 経由で行い market-data を直接 import しない。
 *
 * B2/B4 で読み取り系（取引履歴・実現損益）と入出金を正式契約化した。
 */
export interface PortfolioService {
  applyTrade(trade: Trade): Promise<void>;
  getPositions(accountId: string): Promise<PositionView[]>;
  getSummary(accountId: string): Promise<PortfolioSummary>;
  getHistory(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<EquityPoint[]>;

  /**
   * 入金。現金残高と CashLedger(DEPOSIT) を整合更新する（B4）。
   * spec §2.6（JPY/USD 両建ての初期入金・資金供給）。
   */
  deposit(accountId: string, amount: Money, at?: Date): Promise<void>;
  /**
   * 出金。現金残高と CashLedger(WITHDRAW) を整合更新する（B4）。
   * 残高不足時は実装が DomainError("INSUFFICIENT_FUNDS") を投げる。
   */
  withdraw(accountId: string, amount: Money, at?: Date): Promise<void>;

  /** 取引履歴の一覧（時系列昇順。spec §6.8 GET /accounts/:id/trades。B2）。 */
  getTrades(accountId: string): Promise<Trade[]>;
  /** 実現損益（trade 単位）の一覧（agent-trader の勝率計算等に使う。B2）。 */
  getRealizedPnl(accountId: string): Promise<RealizedPnl[]>;

  /**
   * 税ロット一覧（spec §2.3 P2 / §5.1 TaxLot。Phase 3）。
   * 取得日昇順。`openOnly` が真なら残数量 > 0 の未決済ロットのみ返す。
   * 実際のロット取り崩し（method 別の選択・実現損益算出）は portfolio が担う。
   *
   * 後方互換のため optional とする（Phase 2 の既存実装/フェイクを壊さない）。
   * portfolio の税ロット実装タスクで必須化を検討する。
   */
  getTaxLots?(accountId: string, openOnly?: boolean): Promise<TaxLot[]>;

  /**
   * 譲渡益課税の概算（spec §2.3 P1。Phase 3）。
   * 対象期間にクローズした実現益（RealizedPnl）から通貨別に概算税額を算出して返す
   * （通貨ごとに 1 件の `CapitalGainsTaxEstimate`）。確定申告の正確計算ではなく **概算**
   * （CLAUDE.md §7 免責。損失は通算せず益のみ課税対象とみなす簡略方針）。
   * 適用率の既定は `DEFAULT_CAPITAL_GAINS_TAX_RATE`（20.315%）で、設定で差し替え可能。
   *
   * 後方互換のため optional とする（Phase 2 の既存実装/フェイクを壊さない）。
   * portfolio の実装タスクで必須化を検討する。
   */
  estimateCapitalGainsTax?(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<CapitalGainsTaxEstimate[]>;

  /**
   * コーポレートアクションを口座へ適用する（spec §2.1 P1 分割調整 / §2.3 P1 配当受取）。
   *
   * - **DIVIDEND**: 当該銘柄の保有数量 × 1株あたり配当（`action.value`）を現金へ加算し、
   *   `CashLedgerEntry(DIVIDEND)`（refId=CorporateAction）を起こす。建玉の通貨で受け取る。
   * - **SPLIT**: 保有ポジションの数量・平均取得単価を分割比率（`action.value`）で調整する。
   *   建玉価値（quantity × avgCost）は不変（n:1 で数量を倍に、avgCost を 1/n に）。
   *
   * **概算スコープ**: 源泉徴収・配当課税（所得税/住民税）・端株/端数の現金処理・外国税額控除は
   * 行わない簡略方針（CLAUDE.md §7 免責）。配当は額面どおり現金加算する。税の精緻化は
   * `estimateCapitalGainsTax` 同様、概算スコープ外とする。
   *
   * 後方互換のため optional（Phase 2/3 の既存実装/フェイクを壊さない）。portfolio の
   * 実装タスクで必須化を domain-architect と検討する。
   */
  applyCorporateAction?(accountId: string, action: CorporateAction): Promise<void>;
}

/**
 * 口座状態（現金/保有）の読み取り IF（B2）。
 *
 * trading-engine の発注前チェックや apps/api の結線が、PortfolioService 全体に
 * 依存せず最小限の読み取りだけを行うためのポート。実装は portfolio が提供する。
 */
export interface AccountStateProvider {
  /** 口座の指定通貨の利用可能現金（DecimalString。未登録は "0"）。 */
  getAvailableCash(accountId: string, currency: Currency): Promise<string>;
  /** 口座の指定銘柄の保有数量（未保有は 0）。 */
  getPositionQuantity(accountId: string, instrumentId: string): Promise<number>;
}

/**
 * 銘柄解決の最小 IF（B2）。
 *
 * symbol/通貨など Instrument の属性を id から解決する。agent-trader の
 * AgentObservation や portfolio の通貨導出が利用する。market-data を直接
 * import せず、この IF（実装は market-data / db）に依存する（spec §4.3）。
 */
export interface InstrumentResolver {
  /** 銘柄を id で解決する。未知なら null。 */
  getById(instrumentId: string): Promise<Instrument | null>;
}
