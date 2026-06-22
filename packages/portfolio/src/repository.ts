import type {
  CashBalance,
  CashLedgerEntry,
  Currency,
  EquityPoint,
  MarginType,
  Position,
  PositionSide,
  RealizedPnl,
  RealizedPnlWithLots,
  TaxLot,
  Trade,
} from "@stonks/contracts";

/**
 * portfolio 内部の最小永続化インターフェース（依存性逆転）。
 * 実 DB 結線（@stonks/db）は Phase 2。それまでは in-memory 実装で DI する。
 * db を直接 import しないことで横依存を避ける（CLAUDE.md §0/§4.3）。
 */
export interface PortfolioRepository {
  /**
   * 口座×銘柄のオープンポジション（数量 0 は保持しない）。
   *
   * Phase 5: 建玉一意キーは `[accountId, instrumentId, side, marginType]`
   * （`POSITION_UNIQUE_KEY`）。CASH 現物 / MARGIN 信用の同方向建玉を分離するため、
   * `side`/`marginType` を渡すと厳密に 1 建玉を引く。**後方互換**: `marginType` 省略時は
   * `(side, CASH)` を優先し、無ければ当該 (account, instrument, side) の単一建玉へ
   * フォールバックする（CASH/MARGIN いずれか一方しか無い既存フローは従来挙動）。
   */
  getPosition(
    accountId: string,
    instrumentId: string,
    side?: PositionSide,
    marginType?: MarginType,
  ): Promise<Position | undefined>;
  listPositions(accountId: string): Promise<Position[]>;
  /**
   * 数量 0 は削除、それ以外は upsert。
   * 一意キーは `Position` 自身の `(accountId, instrumentId, side, marginType ?? "CASH")`
   * （Phase 5: CASH/MARGIN を別行で保持）。
   */
  savePosition(position: Position): Promise<void>;
  /**
   * 建玉を削除する。`side`/`marginType` を渡すと厳密キーで削除。省略時は
   * `getPosition` と同じフォールバック（CASH 優先→単一建玉）で 1 建玉を消す。
   */
  removePosition(
    accountId: string,
    instrumentId: string,
    side?: PositionSide,
    marginType?: MarginType,
  ): Promise<void>;

  /** 通貨別現金残高。未登録通貨は呼び出し側が 0 とみなす。 */
  getCashBalance(accountId: string, currency: Currency): Promise<CashBalance | undefined>;
  listCashBalances(accountId: string): Promise<CashBalance[]>;
  saveCashBalance(balance: CashBalance): Promise<void>;

  appendLedgerEntry(entry: CashLedgerEntry): Promise<void>;
  listLedgerEntries(accountId: string): Promise<CashLedgerEntry[]>;

  appendRealizedPnl(entry: RealizedPnl): Promise<void>;
  listRealizedPnl(accountId: string): Promise<RealizedPnl[]>;

  /**
   * 税ロット由来の実現損益詳細（どのロットをいくつ取り崩したか）。Phase 3。
   * 既存 `RealizedPnl` とは別に併記で記録し、税ロットの監査・表示に用いる。
   * 専用の永続化先が無い実装（例: 現状の Prisma 本番リポジトリ）では未提供で良いため optional。
   * 基本の `RealizedPnl` は別途 `appendRealizedPnl` で必ず記録される（情報欠落なし）。
   */
  appendRealizedPnlWithLots?(entry: RealizedPnlWithLots): Promise<void>;
  listRealizedPnlWithLots?(accountId: string): Promise<RealizedPnlWithLots[]>;

  /** 取引履歴（Trade）の追記・参照（B2: 履歴 IF を PortfolioService に出すため）。 */
  appendTrade(trade: Trade): Promise<void>;
  listTrades(accountId: string): Promise<Trade[]>;

  appendEquityPoint(accountId: string, point: EquityPoint): Promise<void>;
  listEquityPoints(accountId: string): Promise<EquityPoint[]>;

  /**
   * 税ロット（spec §2.3 P2 / §5.1 TaxLot。Phase 3）。
   * 取得（買い）ごとに 1 ロットを追記し、売却の取り崩しで `remainingQuantity`
   * を更新（saveTaxLot で upsert）する。一覧は取得日昇順を保証する。
   */
  appendTaxLot(lot: TaxLot): Promise<void>;
  /** 既存ロットの更新（取り崩し後の remainingQuantity を反映）。 */
  saveTaxLot(lot: TaxLot): Promise<void>;
  /** 口座×銘柄の税ロット（取得日昇順）。 */
  listTaxLots(accountId: string, instrumentId?: string): Promise<TaxLot[]>;
}

/** 副作用のない参照だけが欲しい層のための読み取り専用ビュー。 */
export type PortfolioReadModel = Pick<
  PortfolioRepository,
  | "listPositions"
  | "listCashBalances"
  | "listLedgerEntries"
  | "listRealizedPnl"
  | "listTrades"
  | "listEquityPoints"
  | "listTaxLots"
>;
