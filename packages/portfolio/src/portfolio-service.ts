import Decimal from "decimal.js";
import { Money as M } from "@stonks/core-domain";
import { DomainError } from "@stonks/contracts";
import type {
  CashLedgerEntry,
  Currency,
  EquityPoint,
  FxProvider,
  LedgerEntryType,
  Money,
  Position,
  PortfolioService,
  PortfolioSummary,
  PositionView,
  PriceProvider,
  RealizedPnl,
  Trade,
} from "@stonks/contracts";
import type { PortfolioRepository } from "./repository.js";

/** 単調増加 ID 生成器（テスト決定性のため注入可能）。 */
export type IdFactory = () => string;

export interface PortfolioServiceDeps {
  repository: PortfolioRepository;
  priceProvider: PriceProvider;
  fxProvider: FxProvider;
  /** サマリ・履歴の基軸通貨。spec §2.6（口座は基軸通貨を持つ）。 */
  baseCurrency: Currency;
  /** 監査用 ID 生成（省略時は連番）。 */
  newId?: IdFactory;
}

const ZERO = new Decimal(0);

/**
 * 保有・現金・損益の整合を保つ PortfolioService 実装（spec §6.3）。
 *
 * 不変条件（spec §5.2）:
 * - ポジション数量 = Trade の積み上げ。
 * - 現金残高 = CashLedger 合計。
 * - 金額は浮動小数を使わず core-domain の Money 経由で演算する。
 *
 * 価格・為替は PriceProvider / FxProvider IF 経由でのみ取得し、
 * market-data を直接 import しない（依存性逆転・CLAUDE.md §4.3）。
 */
export class DefaultPortfolioService implements PortfolioService {
  private readonly repo: PortfolioRepository;
  private readonly price: PriceProvider;
  private readonly fx: FxProvider;
  private readonly baseCurrency: Currency;
  private readonly newId: IdFactory;
  private seq = 0;

  constructor(deps: PortfolioServiceDeps) {
    this.repo = deps.repository;
    this.price = deps.priceProvider;
    this.fx = deps.fxProvider;
    this.baseCurrency = deps.baseCurrency;
    this.newId = deps.newId ?? (() => `pf-${++this.seq}`);
  }

  /**
   * 入金。現金残高と CashLedger(DEPOSIT) を整合更新する。
   * （取引前の口座資金供給。spec §2.6 JPY/USD 両建て）
   */
  async deposit(accountId: string, amount: Money, at: Date = new Date()): Promise<void> {
    await this.adjustCash(accountId, amount, "DEPOSIT", at);
  }

  /**
   * 出金。現金残高と CashLedger(WITHDRAW) を整合更新する（B4）。
   * 残高不足は受け付けない（spec §5.2 現金 = 台帳合計の整合維持）。
   */
  async withdraw(accountId: string, amount: Money, at: Date = new Date()): Promise<void> {
    const requested = new Decimal(amount.amount);
    if (requested.lte(ZERO)) {
      throw new DomainError("VALIDATION", `withdraw amount must be > 0 (got ${amount.amount})`);
    }
    const existing = await this.repo.getCashBalance(accountId, amount.currency);
    const current = existing ? new Decimal(existing.amount) : ZERO;
    if (requested.gt(current)) {
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        `withdraw ${amount.amount} exceeds cash ${current.toString()} (${amount.currency})`,
      );
    }
    await this.adjustCash(
      accountId,
      M.money(requested.negated(), amount.currency),
      "WITHDRAW",
      at,
    );
  }

  async getTrades(accountId: string): Promise<Trade[]> {
    const trades = await this.repo.listTrades(accountId);
    return trades
      .slice()
      .sort(
        (a, b) =>
          new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
      );
  }

  async getRealizedPnl(accountId: string): Promise<RealizedPnl[]> {
    return this.repo.listRealizedPnl(accountId);
  }

  async applyTrade(trade: Trade): Promise<void> {
    const at = new Date(trade.executedAt);
    const qty = new Decimal(trade.quantity);
    if (qty.lte(ZERO)) {
      throw new Error(`trade quantity must be > 0 (got ${trade.quantity})`);
    }
    const price = new Decimal(trade.price);
    const fee = new Decimal(trade.fee);
    if (fee.lt(ZERO)) {
      throw new Error(`trade fee must be >= 0 (got ${trade.fee})`);
    }
    const principal = price.times(qty); // 約定代金（手数料抜き）

    // 取引履歴を記録（B2: getTrades 用。spec §6.8）。
    await this.repo.appendTrade(trade);

    if (trade.side === "BUY") {
      await this.applyBuy(trade, qty, price, principal, fee, at);
    } else {
      await this.applySell(trade, qty, price, principal, fee, at);
    }

    // 約定後のエクイティスナップショット（決定的: 価格は約定価格＋既存平均建値）。
    await this.snapshotEquity(trade.accountId, at);
  }

  private async applyBuy(
    trade: Trade,
    qty: Decimal,
    _price: Decimal,
    principal: Decimal,
    fee: Decimal,
    at: Date,
  ): Promise<void> {
    const existing = await this.repo.getPosition(
      trade.accountId,
      trade.instrumentId,
    );
    const prevQty = existing ? new Decimal(existing.quantity) : ZERO;
    const prevCost = existing ? new Decimal(existing.avgCost) : ZERO;

    // 取得原価に手数料を含める（建値ベース）。新平均 = (旧原価合計 + 約定代金 + 手数料) / 新数量。
    const prevTotalCost = prevCost.times(prevQty);
    const newQty = prevQty.plus(qty);
    const newTotalCost = prevTotalCost.plus(principal).plus(fee);
    const newAvg = newTotalCost.dividedBy(newQty);

    const position: Position = {
      id: existing?.id ?? this.newId(),
      accountId: trade.accountId,
      instrumentId: trade.instrumentId,
      side: "LONG",
      quantity: newQty.toNumber(),
      avgCost: newAvg.toString(),
      currency: trade.currency, // B3: 建玉通貨を自己記述的に持つ
      openedAt: existing?.openedAt ?? trade.executedAt,
    };
    await this.repo.savePosition(position);

    // 現金: 約定代金 + 手数料の流出。台帳は TRADE(本体) と FEE(手数料) に分離。
    await this.adjustCash(
      trade.accountId,
      M.money(principal.negated(), trade.currency),
      "TRADE",
      at,
      trade.id,
    );
    if (fee.gt(ZERO)) {
      await this.adjustCash(
        trade.accountId,
        M.money(fee.negated(), trade.currency),
        "FEE",
        at,
        trade.id,
      );
    }
  }

  private async applySell(
    trade: Trade,
    qty: Decimal,
    price: Decimal,
    principal: Decimal,
    fee: Decimal,
    at: Date,
  ): Promise<void> {
    const existing = await this.repo.getPosition(
      trade.accountId,
      trade.instrumentId,
    );
    const prevQty = existing ? new Decimal(existing.quantity) : ZERO;
    if (qty.gt(prevQty)) {
      // 現物の売り越し禁止（spec §5.2）。信用は Phase 3。
      throw new Error(
        `cannot sell ${qty.toString()} > held ${prevQty.toString()} for ${trade.instrumentId}`,
      );
    }
    const avg = existing ? new Decimal(existing.avgCost) : ZERO;

    // 実現損益 = 売却代金 - 取得原価(平均建値×数量) - 手数料。
    const costBasis = avg.times(qty);
    const proceeds = principal;
    const realized = proceeds.minus(costBasis).minus(fee);

    const remaining = prevQty.minus(qty);
    if (remaining.lte(ZERO)) {
      await this.repo.removePosition(trade.accountId, trade.instrumentId);
    } else if (existing) {
      // 平均建値は売却で変化しない（一部売却）。
      await this.repo.savePosition({ ...existing, quantity: remaining.toNumber() });
    }

    const realizedEntry: RealizedPnl = {
      id: this.newId(),
      accountId: trade.accountId,
      instrumentId: trade.instrumentId,
      quantity: qty.toNumber(),
      costBasis: costBasis.toString(),
      proceeds: proceeds.toString(),
      realized: realized.toString(),
      currency: trade.currency,
      closedAt: trade.executedAt,
    };
    await this.repo.appendRealizedPnl(realizedEntry);

    // 現金: 売却代金が流入、手数料が流出。
    await this.adjustCash(
      trade.accountId,
      M.money(proceeds, trade.currency),
      "TRADE",
      at,
      trade.id,
    );
    if (fee.gt(ZERO)) {
      await this.adjustCash(
        trade.accountId,
        M.money(fee.negated(), trade.currency),
        "FEE",
        at,
        trade.id,
      );
    }
    // 実現損益の記録（現金移動は TRADE/FEE で既に反映済みなので二重計上しない）。
    await this.repo.appendLedgerEntry({
      id: this.newId(),
      accountId: trade.accountId,
      type: "REALIZED_PNL",
      currency: trade.currency,
      amount: realized.toString(),
      refId: trade.id,
      ts: trade.executedAt,
    });
  }

  async getPositions(accountId: string): Promise<PositionView[]> {
    const positions = await this.repo.listPositions(accountId);
    const views: PositionView[] = [];
    for (const p of positions) {
      const price = await this.price.getLatestPrice(p.instrumentId);
      const px = new Decimal(price.amount);
      const qty = new Decimal(p.quantity);
      const avg = new Decimal(p.avgCost);
      const marketValue = px.times(qty);
      const costValue = avg.times(qty);
      const unrealized = marketValue.minus(costValue);
      const pct = costValue.isZero()
        ? 0
        : unrealized.dividedBy(costValue).times(100).toNumber();
      views.push({
        ...p,
        marketPrice: price.amount,
        marketValue: M.money(marketValue, price.currency),
        unrealizedPnl: M.money(unrealized, price.currency),
        unrealizedPnlPct: pct,
      });
    }
    return views;
  }

  async getSummary(accountId: string): Promise<PortfolioSummary> {
    const base = this.baseCurrency;

    // 現金（通貨別）→ 基軸換算合計。
    let cash = ZERO;
    for (const b of await this.repo.listCashBalances(accountId)) {
      cash = cash.plus(await this.toBase(new Decimal(b.amount), b.currency));
    }

    // ポジション評価額・含み損益 → 基軸換算合計。
    let positionsValue = ZERO;
    let unrealized = ZERO;
    for (const v of await this.getPositions(accountId)) {
      positionsValue = positionsValue.plus(
        await this.toBase(new Decimal(v.marketValue.amount), v.marketValue.currency),
      );
      unrealized = unrealized.plus(
        await this.toBase(
          new Decimal(v.unrealizedPnl.amount),
          v.unrealizedPnl.currency,
        ),
      );
    }

    // 実現損益 → 基軸換算合計。
    let realized = ZERO;
    for (const r of await this.repo.listRealizedPnl(accountId)) {
      realized = realized.plus(await this.toBase(new Decimal(r.realized), r.currency));
    }

    const equity = cash.plus(positionsValue);
    return {
      accountId,
      baseCurrency: base,
      cash: M.money(cash, base),
      positionsValue: M.money(positionsValue, base),
      equity: M.money(equity, base),
      unrealizedPnl: M.money(unrealized, base),
      realizedPnl: M.money(realized, base),
    };
  }

  async getHistory(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<EquityPoint[]> {
    const from = range.from.getTime();
    const to = range.to.getTime();
    const points = await this.repo.listEquityPoints(accountId);
    return points
      .filter((p) => {
        const t = new Date(p.ts).getTime();
        return t >= from && t <= to;
      })
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }

  // ── 内部ヘルパ ──

  /** 現金残高を増減し、対応する CashLedger 行を追記する（残高 = 台帳合計を維持）。 */
  private async adjustCash(
    accountId: string,
    delta: Money,
    type: LedgerEntryType,
    at: Date,
    refId?: string,
  ): Promise<void> {
    const existing = await this.repo.getCashBalance(accountId, delta.currency);
    const current = existing ? M.money(existing.amount, delta.currency) : M.zero(delta.currency);
    const next = M.add(current, delta);
    await this.repo.saveCashBalance({
      accountId,
      currency: delta.currency,
      amount: next.amount,
    });
    const entry: CashLedgerEntry = {
      id: this.newId(),
      accountId,
      type,
      currency: delta.currency,
      amount: delta.amount,
      ts: at.toISOString(),
      ...(refId !== undefined ? { refId } : {}),
    };
    await this.repo.appendLedgerEntry(entry);
  }

  /** USD/JPY のみ対応の基軸換算。同一通貨はそのまま。 */
  private async toBase(amount: Decimal, currency: Currency, at?: Date): Promise<Decimal> {
    if (currency === this.baseCurrency) return amount;
    const fx = await this.fx.getRate("USD", "JPY", at);
    const rate = new Decimal(fx.rate);
    if (currency === "USD" && this.baseCurrency === "JPY") {
      return amount.times(rate);
    }
    // currency === "JPY" && base === "USD"
    return amount.dividedBy(rate);
  }

  /**
   * 約定時点のエクイティを記録する。
   * 価格 IF は副作用なしで呼べる前提だが、履歴の決定性のため
   * 評価額は「現金 + 各ポジション(平均建値×数量)」で算出する。
   */
  private async snapshotEquity(accountId: string, at: Date): Promise<void> {
    let equity = ZERO;
    for (const b of await this.repo.listCashBalances(accountId)) {
      equity = equity.plus(await this.toBase(new Decimal(b.amount), b.currency, at));
    }
    for (const p of await this.repo.listPositions(accountId)) {
      const costValue = new Decimal(p.avgCost).times(p.quantity);
      // B3: 建玉通貨は Position 自身が持つ（内部マップ不要）。
      equity = equity.plus(await this.toBase(costValue, p.currency, at));
    }
    await this.repo.appendEquityPoint(accountId, {
      ts: at.toISOString(),
      equity: equity.toString(),
    });
  }
}
