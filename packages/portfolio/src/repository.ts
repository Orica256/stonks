import type {
  CashBalance,
  CashLedgerEntry,
  Currency,
  EquityPoint,
  Position,
  RealizedPnl,
} from "@stonks/contracts";

/**
 * portfolio 内部の最小永続化インターフェース（依存性逆転）。
 * 実 DB 結線（@stonks/db）は Phase 2。それまでは in-memory 実装で DI する。
 * db を直接 import しないことで横依存を避ける（CLAUDE.md §0/§4.3）。
 */
export interface PortfolioRepository {
  /** 口座×銘柄のオープンポジション（数量 0 は保持しない）。 */
  getPosition(accountId: string, instrumentId: string): Promise<Position | undefined>;
  listPositions(accountId: string): Promise<Position[]>;
  /** 数量 0 は削除、それ以外は upsert。 */
  savePosition(position: Position): Promise<void>;
  removePosition(accountId: string, instrumentId: string): Promise<void>;

  /** 通貨別現金残高。未登録通貨は呼び出し側が 0 とみなす。 */
  getCashBalance(accountId: string, currency: Currency): Promise<CashBalance | undefined>;
  listCashBalances(accountId: string): Promise<CashBalance[]>;
  saveCashBalance(balance: CashBalance): Promise<void>;

  appendLedgerEntry(entry: CashLedgerEntry): Promise<void>;
  listLedgerEntries(accountId: string): Promise<CashLedgerEntry[]>;

  appendRealizedPnl(entry: RealizedPnl): Promise<void>;
  listRealizedPnl(accountId: string): Promise<RealizedPnl[]>;

  appendEquityPoint(accountId: string, point: EquityPoint): Promise<void>;
  listEquityPoints(accountId: string): Promise<EquityPoint[]>;
}

/** 副作用のない参照だけが欲しい層のための読み取り専用ビュー。 */
export type PortfolioReadModel = Pick<
  PortfolioRepository,
  | "listPositions"
  | "listCashBalances"
  | "listLedgerEntries"
  | "listRealizedPnl"
  | "listEquityPoints"
>;
