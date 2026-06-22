import Decimal from "decimal.js";
import {
  Money as M,
  estimateCapitalGainsTax as estimateCapitalGainsTaxAmount,
} from "@stonks/core-domain";
import { DEFAULT_CAPITAL_GAINS_TAX_RATE, DomainError } from "@stonks/contracts";
import type {
  CapitalGainsTaxEstimate,
  CashLedgerEntry,
  CorporateAction,
  CostBasisMethod,
  Currency,
  EquityPoint,
  FxProvider,
  LedgerEntryType,
  MarginInfo,
  Money,
  Position,
  PortfolioService,
  PortfolioSummary,
  PositionView,
  PriceProvider,
  Rate,
  RealizedPnl,
  TaxAccountType,
  TaxLot,
  TaxLotConsumption,
  Trade,
} from "@stonks/contracts";
import type { PortfolioRepository } from "./repository.js";

/** 単調増加 ID 生成器（テスト決定性のため注入可能）。 */
export type IdFactory = () => string;

/**
 * 信用建玉の保証金/金利情報を Trade から解決する任意フック（Phase 3）。
 *
 * 率・必要保証金の計算は trading-engine の責務。portfolio は受領した Trade と
 * ロット管理に集中するため、MARGIN 建玉の `Position.margin`(MarginInfo) が必要な
 * 場合のみこのフックで供給する。未注入なら MARGIN 建玉は `marginType` のみ自己記述的に
 * 設定し `margin` は付さない（現物=CASH は常に未設定で既存挙動を保つ）。
 */
export type MarginInfoResolver = (trade: Trade) => MarginInfo | undefined;

export interface PortfolioServiceDeps {
  repository: PortfolioRepository;
  priceProvider: PriceProvider;
  fxProvider: FxProvider;
  /** サマリ・履歴の基軸通貨。spec §2.6（口座は基軸通貨を持つ）。 */
  baseCurrency: Currency;
  /** 監査用 ID 生成（省略時は連番）。 */
  newId?: IdFactory;
  /**
   * 税ロットの取得単価計算方式（spec §2.3 P2）。
   * 既定 AVERAGE（総平均/移動平均。Phase 2 の実現損益＝平均建値と完全一致し後方互換）。
   */
  costBasisMethod?: CostBasisMethod;
  /** 税ロットの口座区分（spec §2.3「特定/一般」）。既定 SPECIFIC。 */
  taxAccountType?: TaxAccountType;
  /** MARGIN 建玉の保証金/金利情報を Trade から解決する任意フック（Phase 3）。 */
  marginInfoResolver?: MarginInfoResolver;
  /**
   * 譲渡益課税の概算率（spec §2.3 P1）。省略時は DEFAULT_CAPITAL_GAINS_TAX_RATE（20.315%）。
   * 口座区分・通貨で差し替え可能（例 US 口座、NISA 非課税は "0"）。`Rate`（DecimalString）。
   */
  capitalGainsTaxRate?: Rate;
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
  private readonly costBasisMethod: CostBasisMethod;
  private readonly taxAccountType: TaxAccountType;
  private readonly marginInfoResolver: MarginInfoResolver | undefined;
  private readonly capitalGainsTaxRate: Rate;
  private seq = 0;

  constructor(deps: PortfolioServiceDeps) {
    this.repo = deps.repository;
    this.price = deps.priceProvider;
    this.fx = deps.fxProvider;
    this.baseCurrency = deps.baseCurrency;
    this.newId = deps.newId ?? (() => `pf-${++this.seq}`);
    this.costBasisMethod = deps.costBasisMethod ?? "AVERAGE";
    this.taxAccountType = deps.taxAccountType ?? "SPECIFIC";
    this.marginInfoResolver = deps.marginInfoResolver;
    this.capitalGainsTaxRate =
      deps.capitalGainsTaxRate ?? DEFAULT_CAPITAL_GAINS_TAX_RATE;
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

  /**
   * 税ロット一覧（spec §2.3 P2）。`openOnly` で残数量 > 0 の未決済ロットに絞る。
   * 取得日昇順（repository が保証）。
   */
  async getTaxLots(accountId: string, openOnly = false): Promise<TaxLot[]> {
    const lots = await this.repo.listTaxLots(accountId);
    return openOnly
      ? lots.filter((l) => new Decimal(l.remainingQuantity).gt(ZERO))
      : lots;
  }

  /**
   * 譲渡益課税の「概算」を通貨別に算出する（spec §2.3 P1。Phase 3）。
   *
   * 対象期間（`range.from`〜`range.to`、UTC、`closedAt` で両端含めて絞る）にクローズした
   * RealizedPnl を通貨ごとに集計し、各通貨の実現損益合計（`realizedGains`）から概算税額を求める。
   * 税額計算は core-domain の純関数 `estimateCapitalGainsTax` に委譲し、自前で率計算しない。
   *
   * **これは確定申告の正確計算ではなく概算**（CLAUDE.md §7 免責。投資助言ではない）:
   * - 損益通算・繰越控除・各種特例は行わない。**益のみ課税対象**とみなし、損失通貨は税額 0。
   * - 適用率は `capitalGainsTaxRate`（既定 DEFAULT_CAPITAL_GAINS_TAX_RATE = 20.315%）。設定で差し替え可。
   * - 金額は浮動小数を使わず DecimalString（CLAUDE.md §0）。基軸換算はしない（通貨別に返す）。
   *
   * 対象期間に実現損益が 1 件もない通貨は結果に含めない（実現があった通貨のみ返す）。
   * 通貨は安定した順序（最初に出現した順）で返す。
   */
  async estimateCapitalGainsTax(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<CapitalGainsTaxEstimate[]> {
    const from = range.from.getTime();
    const to = range.to.getTime();
    const entries = await this.repo.listRealizedPnl(accountId);

    // 通貨別に実現損益を合算（出現順を保持して決定的に返す）。
    const order: Currency[] = [];
    const gainsByCurrency = new Map<Currency, Decimal>();
    for (const e of entries) {
      const t = new Date(e.closedAt).getTime();
      if (t < from || t > to) continue; // 範囲外（両端含む）
      const prev = gainsByCurrency.get(e.currency);
      if (prev === undefined) {
        order.push(e.currency);
        gainsByCurrency.set(e.currency, new Decimal(e.realized));
      } else {
        gainsByCurrency.set(e.currency, prev.plus(e.realized));
      }
    }

    const taxRate = this.capitalGainsTaxRate;
    const normalizedRange = {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    };
    return order.map((currency) => {
      const realizedGains = gainsByCurrency.get(currency)!.toString();
      return {
        accountId,
        range: normalizedRange,
        currency,
        realizedGains,
        taxRate,
        // 純関数に委譲（損失は 0 床。max(realizedGains, 0) × taxRate）。
        estimatedTax: estimateCapitalGainsTaxAmount(realizedGains, taxRate),
      };
    });
  }

  /**
   * コーポレートアクションを口座へ適用する（spec §2.1 P1 分割調整 / §2.3 P1 配当受取）。
   *
   * 当該口座の当該銘柄の **保有ポジションがある場合のみ** 作用する（未保有=数量 0 は no-op）。
   * 評価時刻は `action.exDate`（UTC）を用い、現金台帳・エクイティ点はこの時刻で記録する。
   *
   * ### DIVIDEND（配当受取）
   * - `配当額 = 保有数量 × action.value`（1 株あたり配当額, DecimalString, decimal.js で計算）。
   * - 建玉通貨（`Position.currency`）建てで現金残高を増やし、`CashLedgerEntry(DIVIDEND)` を 1 件記録。
   *   refId は `div:<instrumentId>:<exDate>`（同一アクションを冪等に追跡できる安定キー）。
   * - **概算スコープ**: 源泉徴収・配当課税（所得税/住民税）・外国税額控除・端株処理は行わず、
   *   **額面どおり**現金加算する簡略方針（CLAUDE.md §7 免責。投資助言ではない）。
   * - ポジションの数量・平均取得単価・税ロットは変更しない（配当は現金イベント）。
   *
   * ### SPLIT（株式分割）
   * - `action.value` を **分割比率** として解釈する（"2" = 1→2 株の 2 分割、"0.5" = 2→1 株の併合）。
   * - `quantity` を `× 比率`、`avgCost`（平均取得単価）を `÷ 比率` に調整する。
   *   よって建玉簿価（`quantity × avgCost`）は不変（数学的恒等。丸めは avgCost 側のみ）。
   * - 数量は整数で表現するため `比率 × 数量` を四捨五入で丸め（端株は概算スコープ外。整数株前提）。
   *   平均取得単価 `avgCost` は丸めず DecimalString のまま保持し簿価の不変性を最大限保つ。
   * - 税ロットがあれば各ロットの `quantity` / `remainingQuantity` も `× 比率`（四捨五入）、
   *   `costBasis` を `÷ 比率` に調整し、建玉とロットの整合（合計数量・簿価）を保つ。
   * - 配当と異なり現金・実現損益は動かさない（建玉価値不変のコーポレートアクション）。
   */
  async applyCorporateAction(
    accountId: string,
    action: CorporateAction,
  ): Promise<void> {
    const position = await this.repo.getPosition(accountId, action.instrumentId);
    // 未保有（数量 0）は配当・分割いずれも作用しない（spec §5.2 整合: 建玉が無ければ調整対象が無い）。
    if (!position || new Decimal(position.quantity).lte(ZERO)) return;

    const at = new Date(action.exDate);
    if (action.type === "DIVIDEND") {
      await this.applyDividend(position, action, at);
    } else {
      await this.applySplit(accountId, position, action);
    }
  }

  /**
   * 配当受取: 保有数量 × 1 株配当を建玉通貨で現金へ加算し CashLedger(DIVIDEND) を 1 件起こす。
   * 額面受領（源泉/課税は概算スコープ外）。現金残高 = 台帳合計の不変条件は adjustCash が維持する。
   */
  private async applyDividend(
    position: Position,
    action: CorporateAction,
    at: Date,
  ): Promise<void> {
    const perShare = new Decimal(action.value);
    const amount = new Decimal(position.quantity).times(perShare);
    if (amount.lte(ZERO)) return; // 配当 0（または負）は現金イベントを起こさない。
    await this.adjustCash(
      position.accountId,
      M.money(amount, position.currency),
      "DIVIDEND",
      at,
      `div:${action.instrumentId}:${action.exDate}`,
    );
  }

  /**
   * 株式分割: 比率（action.value）で建玉とロットを調整する。建玉簿価は不変。
   * 数量は整数株前提のため四捨五入、平均取得単価/ロット原価は丸めず簿価不変性を保つ。
   */
  private async applySplit(
    accountId: string,
    position: Position,
    action: CorporateAction,
  ): Promise<void> {
    const ratio = new Decimal(action.value);
    if (ratio.lte(ZERO)) {
      throw new DomainError(
        "VALIDATION",
        `split ratio must be > 0 (got ${action.value})`,
      );
    }

    // 数量は ×比率（整数株前提で四捨五入）。平均取得単価は ÷比率（丸めず簿価不変を維持）。
    const newQty = new Decimal(position.quantity)
      .times(ratio)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const newAvg = new Decimal(position.avgCost).dividedBy(ratio);
    await this.repo.savePosition({
      ...position,
      quantity: newQty.toNumber(),
      avgCost: newAvg.toString(),
    });

    // 税ロットも同比率で調整し、建玉合計とロット合計の整合（数量・簿価）を保つ。
    const lots = await this.repo.listTaxLots(accountId, action.instrumentId);
    for (const lot of lots) {
      const lotQty = new Decimal(lot.quantity)
        .times(ratio)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      const lotRemain = new Decimal(lot.remainingQuantity)
        .times(ratio)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      const lotCost = new Decimal(lot.costBasis).dividedBy(ratio);
      await this.repo.saveTaxLot({
        ...lot,
        quantity: lotQty.toNumber(),
        remainingQuantity: lotRemain.toNumber(),
        costBasis: lotCost.toString(),
      });
    }
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
    // Phase 5: 建玉は (account, instrument, side=LONG, marginType ?? "CASH") で一意。
    // CASH 現物と MARGIN 信用の同方向買いは別建玉として独立に積み上げる。
    const marginType = trade.marginType ?? "CASH";
    const existing = await this.repo.getPosition(
      trade.accountId,
      trade.instrumentId,
      "LONG",
      marginType,
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
      // Phase 3: 資金区分は Trade を信頼して振り分ける（既定 CASH は未設定で既存挙動を維持）。
      ...this.resolveMargin(trade, existing),
    };
    await this.repo.savePosition(position);

    // Phase 3: 取得（買い）ごとに税ロットを 1 件起こす（spec §2.3 P2 / §5.1 TaxLot）。
    // ロット取得単価は手数料込みの 1 株あたり取得価額（= Position.avgCost と同じ建値基準）。
    const lotCostBasis = principal.plus(fee).dividedBy(qty);
    const taxLot: TaxLot = {
      id: this.newId(),
      accountId: trade.accountId,
      instrumentId: trade.instrumentId,
      quantity: qty.toNumber(),
      remainingQuantity: qty.toNumber(),
      costBasis: lotCostBasis.toString(),
      currency: trade.currency,
      acquiredAt: trade.executedAt,
      method: this.costBasisMethod,
      taxAccountType: this.taxAccountType,
      acquiredTradeId: trade.id,
    };
    await this.repo.appendTaxLot(taxLot);

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

  /**
   * Trade の資金区分から建玉の marginType / margin を解決する（Phase 3）。
   * - CASH/未指定（現物）: 何も付さない（既存挙動を維持）。
   * - MARGIN（信用）: `marginType="MARGIN"` を設定。保証金/金利情報（MarginInfo）は
   *   率計算が trading-engine 責務のため、注入された marginInfoResolver があれば付す
   *   （既存建玉に margin があれば保持）。
   */
  private resolveMargin(
    trade: Trade,
    existing: Position | undefined,
  ): Pick<Position, "marginType" | "margin"> {
    if (trade.marginType !== "MARGIN") return {};
    const margin =
      this.marginInfoResolver?.(trade) ?? existing?.margin;
    return {
      marginType: "MARGIN",
      ...(margin !== undefined ? { margin } : {}),
    };
  }

  private async applySell(
    trade: Trade,
    qty: Decimal,
    price: Decimal,
    principal: Decimal,
    fee: Decimal,
    at: Date,
  ): Promise<void> {
    // Phase 5: 売りは買いと同じ建玉キー（marginType ?? "CASH"）に当てる。
    // CASH 建玉の売りは CASH を、MARGIN 建玉の売りは MARGIN を取り崩す。
    const marginType = trade.marginType ?? "CASH";
    const existing = await this.repo.getPosition(
      trade.accountId,
      trade.instrumentId,
      "LONG",
      marginType,
    );
    const prevQty = existing ? new Decimal(existing.quantity) : ZERO;
    if (qty.gt(prevQty)) {
      // 現物の売り越し禁止（spec §5.2）。信用は Phase 3。
      throw new Error(
        `cannot sell ${qty.toString()} > held ${prevQty.toString()} for ${trade.instrumentId}`,
      );
    }
    const avg = existing ? new Decimal(existing.avgCost) : ZERO;

    // Phase 3: 取得単価計算方式（method）に従って税ロットを取り崩す。
    // AVERAGE は平均建値ベースで取得原価を出し、Phase 2 の実現損益と完全一致する。
    // FIFO/LIFO/SPECIFIC_LOT は選択ロットの取得単価合計を取得原価にする。
    const { consumptions, costBasis } = await this.consumeTaxLots(
      trade,
      qty,
      avg,
    );

    // 実現損益 = 売却代金 - 取得原価 - 手数料。
    const proceeds = principal;
    const realized = proceeds.minus(costBasis).minus(fee);

    const remaining = prevQty.minus(qty);
    if (remaining.lte(ZERO)) {
      await this.repo.removePosition(
        trade.accountId,
        trade.instrumentId,
        "LONG",
        marginType,
      );
    } else if (existing) {
      // 平均建値は売却で変化しない（一部売却。method 非依存で残ロットと整合する）。
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
    // 税ロット由来の詳細（どのロットをいくつ取り崩したか）も併記で記録する
    // （専用永続化先を持たないリポジトリでは optional なので存在時のみ）。
    await this.repo.appendRealizedPnlWithLots?.({
      ...realizedEntry,
      lots: consumptions,
      method: this.costBasisMethod,
      ...(trade.id !== undefined ? { closedTradeId: trade.id } : {}),
    });

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

  /**
   * 売却数量 `qty` を取得単価計算方式（method）に従って税ロットから取り崩す（spec §2.3 P2）。
   * - FIFO: 取得日昇順、LIFO: 降順、SPECIFIC_LOT: 明示選択が無いため当面 FIFO 順に倒す。
   * - AVERAGE: 取り崩し自体は FIFO 順で remainingQuantity を減らすが、取得原価は
   *   平均建値（`avgCost × qty`）を用い、Phase 2 の実現損益と完全一致させる。
   * 取り崩した各ロットの remainingQuantity を upsert し、内訳（TaxLotConsumption）と
   * 取得原価合計（costBasis）を返す。
   */
  private async consumeTaxLots(
    trade: Trade,
    qty: Decimal,
    avgCost: Decimal,
  ): Promise<{ consumptions: TaxLotConsumption[]; costBasis: Decimal }> {
    const lots = await this.repo.listTaxLots(trade.accountId, trade.instrumentId);
    const open = lots.filter((l) => new Decimal(l.remainingQuantity).gt(ZERO));
    const ordered = this.costBasisMethod === "LIFO" ? [...open].reverse() : open;

    const consumptions: TaxLotConsumption[] = [];
    let remaining = qty;
    let lotCostBasis = ZERO; // FIFO/LIFO/SPECIFIC_LOT 用の取り崩しロット原価合計

    for (const lot of ordered) {
      if (remaining.lte(ZERO)) break;
      const lotRemain = new Decimal(lot.remainingQuantity);
      const take = Decimal.min(lotRemain, remaining);
      consumptions.push({
        taxLotId: lot.id,
        quantity: take.toNumber(),
        costBasis: lot.costBasis,
      });
      lotCostBasis = lotCostBasis.plus(take.times(new Decimal(lot.costBasis)));
      await this.repo.saveTaxLot({
        ...lot,
        remainingQuantity: lotRemain.minus(take).toNumber(),
      });
      remaining = remaining.minus(take);
    }

    const costBasis =
      this.costBasisMethod === "AVERAGE" ? avgCost.times(qty) : lotCostBasis;
    return { consumptions, costBasis };
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
