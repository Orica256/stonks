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
import type { PortfolioRepository } from "./repository.js";

/**
 * 建玉の一意キー（spec §5.1 / `POSITION_UNIQUE_KEY`。Phase 5）。
 * `[accountId, instrumentId, side, marginType]` で一意化し、同一 (account, instrument,
 * side) の CASH 現物 / MARGIN 信用建玉を別行に分離する。`side`/`marginType` 未指定は
 * 既存挙動どおり LONG / CASH とみなす（`marginType ?? "CASH"`）。
 */
const posKey = (
  accountId: string,
  instrumentId: string,
  side: PositionSide = "LONG",
  marginType: MarginType = "CASH",
): string => `${accountId}::${instrumentId}::${side}::${marginType}`;
const cashKey = (accountId: string, currency: Currency): string =>
  `${accountId}::${currency}`;

/**
 * テスト・Phase 1 用のメモリ内リポジトリ。
 * 実 DB（@stonks/db）への差し替えは PortfolioRepository を実装する別クラスで行う。
 */
export class InMemoryPortfolioRepository implements PortfolioRepository {
  private readonly positions = new Map<string, Position>();
  private readonly cash = new Map<string, CashBalance>();
  private readonly ledger = new Map<string, CashLedgerEntry[]>();
  private readonly realized = new Map<string, RealizedPnl[]>();
  private readonly realizedWithLots = new Map<string, RealizedPnlWithLots[]>();
  private readonly trades = new Map<string, Trade[]>();
  private readonly equity = new Map<string, EquityPoint[]>();
  /** 税ロット（追記順を保持。listTaxLots で取得日昇順に整列）。 */
  private readonly taxLots = new Map<string, TaxLot[]>();

  async getPosition(
    accountId: string,
    instrumentId: string,
    side?: PositionSide,
    marginType?: MarginType,
  ): Promise<Position | undefined> {
    // marginType が明示されたら厳密キーで引く（Phase 5: CASH/MARGIN を別建玉に分離）。
    if (marginType !== undefined) {
      return this.positions.get(
        posKey(accountId, instrumentId, side ?? "LONG", marginType),
      );
    }
    // 後方互換: marginType 未指定は (side, CASH) を優先し、無ければ当該 (account,
    // instrument, side) の単一建玉へフォールバック（CASH/MARGIN いずれか一方しか
    // 無い既存フローで従来どおり 1 建玉を返す）。
    const wantSide = side ?? "LONG";
    const cash = this.positions.get(
      posKey(accountId, instrumentId, wantSide, "CASH"),
    );
    if (cash) return cash;
    return [...this.positions.values()].find(
      (p) =>
        p.accountId === accountId &&
        p.instrumentId === instrumentId &&
        (p.side ?? "LONG") === wantSide,
    );
  }

  async listPositions(accountId: string): Promise<Position[]> {
    return [...this.positions.values()].filter((p) => p.accountId === accountId);
  }

  async savePosition(position: Position): Promise<void> {
    this.positions.set(
      posKey(
        position.accountId,
        position.instrumentId,
        position.side ?? "LONG",
        position.marginType ?? "CASH",
      ),
      { ...position },
    );
  }

  async removePosition(
    accountId: string,
    instrumentId: string,
    side?: PositionSide,
    marginType?: MarginType,
  ): Promise<void> {
    if (marginType !== undefined) {
      this.positions.delete(
        posKey(accountId, instrumentId, side ?? "LONG", marginType),
      );
      return;
    }
    // 後方互換: marginType 未指定は (side, CASH) を優先削除。無ければ当該 (account,
    // instrument, side) の単一建玉のキーを解決して削除する。
    const wantSide = side ?? "LONG";
    const cashK = posKey(accountId, instrumentId, wantSide, "CASH");
    if (this.positions.has(cashK)) {
      this.positions.delete(cashK);
      return;
    }
    for (const [k, p] of this.positions) {
      if (
        p.accountId === accountId &&
        p.instrumentId === instrumentId &&
        (p.side ?? "LONG") === wantSide
      ) {
        this.positions.delete(k);
        return;
      }
    }
  }

  async getCashBalance(
    accountId: string,
    currency: Currency,
  ): Promise<CashBalance | undefined> {
    return this.cash.get(cashKey(accountId, currency));
  }

  async listCashBalances(accountId: string): Promise<CashBalance[]> {
    return [...this.cash.values()].filter((b) => b.accountId === accountId);
  }

  async saveCashBalance(balance: CashBalance): Promise<void> {
    this.cash.set(cashKey(balance.accountId, balance.currency), { ...balance });
  }

  async appendLedgerEntry(entry: CashLedgerEntry): Promise<void> {
    const list = this.ledger.get(entry.accountId) ?? [];
    list.push({ ...entry });
    this.ledger.set(entry.accountId, list);
  }

  async listLedgerEntries(accountId: string): Promise<CashLedgerEntry[]> {
    return [...(this.ledger.get(accountId) ?? [])];
  }

  async appendRealizedPnl(entry: RealizedPnl): Promise<void> {
    const list = this.realized.get(entry.accountId) ?? [];
    list.push({ ...entry });
    this.realized.set(entry.accountId, list);
  }

  async listRealizedPnl(accountId: string): Promise<RealizedPnl[]> {
    return [...(this.realized.get(accountId) ?? [])];
  }

  async appendRealizedPnlWithLots(entry: RealizedPnlWithLots): Promise<void> {
    const list = this.realizedWithLots.get(entry.accountId) ?? [];
    list.push({ ...entry });
    this.realizedWithLots.set(entry.accountId, list);
  }

  async listRealizedPnlWithLots(
    accountId: string,
  ): Promise<RealizedPnlWithLots[]> {
    return [...(this.realizedWithLots.get(accountId) ?? [])];
  }

  async appendTrade(trade: Trade): Promise<void> {
    const list = this.trades.get(trade.accountId) ?? [];
    list.push({ ...trade });
    this.trades.set(trade.accountId, list);
  }

  async listTrades(accountId: string): Promise<Trade[]> {
    return [...(this.trades.get(accountId) ?? [])];
  }

  async appendEquityPoint(
    accountId: string,
    point: EquityPoint,
  ): Promise<void> {
    const list = this.equity.get(accountId) ?? [];
    list.push({ ...point });
    this.equity.set(accountId, list);
  }

  async listEquityPoints(accountId: string): Promise<EquityPoint[]> {
    return [...(this.equity.get(accountId) ?? [])];
  }

  async appendTaxLot(lot: TaxLot): Promise<void> {
    const list = this.taxLots.get(lot.accountId) ?? [];
    list.push({ ...lot });
    this.taxLots.set(lot.accountId, list);
  }

  async saveTaxLot(lot: TaxLot): Promise<void> {
    const list = this.taxLots.get(lot.accountId) ?? [];
    const idx = list.findIndex((l) => l.id === lot.id);
    if (idx >= 0) {
      list[idx] = { ...lot };
    } else {
      list.push({ ...lot });
    }
    this.taxLots.set(lot.accountId, list);
  }

  async listTaxLots(
    accountId: string,
    instrumentId?: string,
  ): Promise<TaxLot[]> {
    return [...(this.taxLots.get(accountId) ?? [])]
      .filter((l) => instrumentId === undefined || l.instrumentId === instrumentId)
      .sort(
        (a, b) =>
          new Date(a.acquiredAt).getTime() - new Date(b.acquiredAt).getTime(),
      );
  }
}
