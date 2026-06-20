import Decimal from "decimal.js";
import { isValidLot, Money, roundToTick } from "@stonks/core-domain";
import {
  DomainError,
  PlaceOrderCommand as PlaceOrderCommandSchema,
} from "@stonks/contracts";
import type {
  FeeModel,
  Instrument,
  InterestAccrual,
  MarginPolicy,
  MarginPolicyProvider,
  Order,
  PlaceOrderCommand,
  PositionSide,
  PriceProvider,
  Trade,
} from "@stonks/contracts";
import type {
  AccountStateProvider,
  InstrumentProvider,
  OrderRepository,
} from "./ports.js";
import { SlippageFillModel } from "./fill-model.js";
import {
  annualRateForSide,
  computeInterestAccrual,
  computeMarginRequirement,
  daysBetween,
  hasSufficientMargin,
} from "./margin.js";

/**
 * 1 回の評価で約定可能な最大数量を返す流動性モデル（部分約定の源泉）。
 * 既定は残数量を全量返す（= 全量約定）。テストや現実的な薄商いの再現で差し替える。
 */
export interface LiquidityModel {
  maxFillQuantity(order: Order, marketPrice: string): number;
}

const UNLIMITED_LIQUIDITY: LiquidityModel = {
  maxFillQuantity: (order) => order.quantity - order.filledQuantity,
};

export interface TradingEngineDeps {
  orders: OrderRepository;
  accountState: AccountStateProvider;
  instruments: InstrumentProvider;
  feeModel: FeeModel;
  fillModel: SlippageFillModel;
  /**
   * 信用建ての保証金/金利規定値プロバイダ（任意。Phase 3）。
   * 未注入だと MARGIN 発注は「信用不可」として一律拒否される（現物 CASH は影響なし）。
   */
  marginPolicy?: MarginPolicyProvider;
  /** 部分約定のための流動性モデル（任意。既定=全量約定）。 */
  liquidity?: LiquidityModel;
  /** ID 採番（任意。既定 crypto.randomUUID）。 */
  generateId?: () => string;
  /** 現在時刻（任意。テスト用に注入可能。既定 () => new Date()）。 */
  clock?: () => Date;
}

const OPEN_STATUSES = new Set<Order["status"]>(["PENDING", "PARTIALLY_FILLED"]);

/**
 * 既定の ID 採番。Node 20+ / モダンランタイムの Web Crypto を使う。
 * 型依存（@types/node）を避けるため最小宣言経由で参照し、無ければ時刻+乱数にフォールバック。
 */
const defaultIdGenerator = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * 注文ライフサイクル・約定評価・手数料を司る TradingEngine 実装（spec §6.2）。
 * 価格は PriceProvider IF 経由でのみ取得し market-data を直接 import しない。
 */
export class StandardTradingEngine {
  private readonly orders: OrderRepository;
  private readonly accountState: AccountStateProvider;
  private readonly instruments: InstrumentProvider;
  private readonly feeModel: FeeModel;
  private readonly fillModel: SlippageFillModel;
  private readonly marginPolicy: MarginPolicyProvider | undefined;
  private readonly liquidity: LiquidityModel;
  private readonly generateId: () => string;
  private readonly clock: () => Date;
  /** STOP / STOP_LIMIT のトリガ済みフラグ（orderId 単位）。 */
  private readonly triggered = new Set<string>();

  constructor(deps: TradingEngineDeps) {
    this.orders = deps.orders;
    this.accountState = deps.accountState;
    this.instruments = deps.instruments;
    this.feeModel = deps.feeModel;
    this.fillModel = deps.fillModel;
    this.marginPolicy = deps.marginPolicy;
    this.liquidity = deps.liquidity ?? UNLIMITED_LIQUIDITY;
    this.generateId = deps.generateId ?? defaultIdGenerator;
    this.clock = deps.clock ?? (() => new Date());
  }

  /** 発注: Zod 検証 → 単元/呼値ルール＋現金/保有の事前チェック → PENDING 受付。 */
  async placeOrder(cmd: PlaceOrderCommand): Promise<Order> {
    const parsed = PlaceOrderCommandSchema.safeParse(cmd);
    if (!parsed.success) {
      throw new DomainError("VALIDATION", "invalid PlaceOrderCommand", parsed.error.issues);
    }
    const command = parsed.data;

    const instrument = await this.instruments.getById(command.instrumentId);
    if (!instrument) {
      throw new DomainError("NOT_FOUND", `instrument not found: ${command.instrumentId}`);
    }

    // 単元株ルール（端株禁止）。
    if (!isValidLot(command.quantity, instrument)) {
      throw new DomainError(
        "VALIDATION",
        `quantity ${command.quantity} is not a multiple of lotSize ${instrument.lotSize}`,
      );
    }

    // 呼値刻み: 指値/逆指値の価格を tick に丸めて受け付ける。
    const limitPrice =
      command.limitPrice !== undefined
        ? roundToTick(command.limitPrice, instrument, command.side)
        : undefined;
    const stopPrice =
      command.stopPrice !== undefined
        ? roundToTick(command.stopPrice, instrument, command.side)
        : undefined;

    // 資金区分。未指定/CASH=現物、MARGIN=信用。
    const isMargin = command.marginType === "MARGIN";

    if (isMargin) {
      // 信用: 銘柄ポリシーを解決し（null=信用不可→拒否）、必要保証金を充足判定する。
      // ショート（SELL × MARGIN）は現物の保有数量チェックを通さず別ルートで建てる。
      await this.assertMarginAffordable(command, instrument, limitPrice);
    } else {
      // 現物: 現金（買い）/ 保有（売り）の事前チェック。
      await this.assertAffordable(command, instrument, limitPrice);
    }

    const now = this.clock().toISOString();
    const order: Order = {
      id: this.generateId(),
      accountId: command.accountId,
      instrumentId: command.instrumentId,
      side: command.side,
      type: command.type,
      quantity: command.quantity,
      filledQuantity: 0,
      ...(limitPrice !== undefined ? { limitPrice } : {}),
      ...(stopPrice !== undefined ? { stopPrice } : {}),
      timeInForce: command.timeInForce,
      // MARGIN のみ明示。CASH/未指定は現物として marginType を載せず後方互換に保つ。
      ...(isMargin ? { marginType: "MARGIN" as const } : {}),
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    };

    await this.orders.save(order);
    return order;
  }

  /** 取消: PENDING / PARTIALLY_FILLED のみ可。それ以外は ORDER_NOT_CANCELLABLE。 */
  async cancelOrder(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw new DomainError("NOT_FOUND", `order not found: ${orderId}`);
    }
    if (!OPEN_STATUSES.has(order.status)) {
      throw new DomainError(
        "ORDER_NOT_CANCELLABLE",
        `order ${orderId} is ${order.status} and cannot be cancelled`,
      );
    }
    const updated: Order = {
      ...order,
      status: "CANCELLED",
      updatedAt: this.clock().toISOString(),
    };
    await this.orders.update(updated);
    this.triggered.delete(orderId);
    return updated;
  }

  /** オープン注文を価格で評価し、約定（Trade）を生成する。DAY は当日中に失効。 */
  async evaluateOpenOrders(ctx: {
    now: Date;
    priceProvider: PriceProvider;
  }): Promise<Trade[]> {
    const open = await this.orders.findOpen();
    const trades: Trade[] = [];

    for (const order of open) {
      // DAY 失効: 発注日（UTC 日付）より後なら EXPIRED。
      if (order.timeInForce === "DAY" && this.isExpired(order, ctx.now)) {
        await this.orders.update({
          ...order,
          status: "EXPIRED",
          updatedAt: ctx.now.toISOString(),
        });
        this.triggered.delete(order.id);
        continue;
      }

      const instrument = await this.instruments.getById(order.instrumentId);
      if (!instrument) continue;

      const priceMoney = await ctx.priceProvider.getLatestPrice(
        order.instrumentId,
        ctx.now,
      );
      const marketPrice = priceMoney.amount;

      // STOP / STOP_LIMIT のトリガ判定（一度トリガしたら維持）。
      const stopTriggered = this.evaluateTrigger(order, marketPrice);

      const fill = this.fillModel.tryFillTriggered(
        order,
        marketPrice,
        stopTriggered,
      );
      if (!fill) continue;

      // 部分約定: 流動性モデルで上限をかける。
      const remaining = order.quantity - order.filledQuantity;
      const cap = Math.max(
        0,
        Math.min(this.liquidity.maxFillQuantity(order, marketPrice), remaining),
      );
      if (cap <= 0) continue;
      const fillQty = Math.min(fill.quantity, cap);
      if (fillQty <= 0) continue;

      const trade = await this.recordTrade(
        order,
        instrument,
        fillQty,
        fill.price,
        ctx.now,
      );
      trades.push(trade);
    }

    return trades;
  }

  /** 約定 1 件を記録し、注文状態を遷移させる。 */
  private async recordTrade(
    order: Order,
    instrument: Instrument,
    fillQty: number,
    price: string,
    now: Date,
  ): Promise<Trade> {
    const { fee } = this.feeModel.calculate({
      instrument,
      side: order.side,
      quantity: fillQty,
      price,
    });

    const trade: Trade = {
      id: this.generateId(),
      orderId: order.id,
      accountId: order.accountId,
      instrumentId: order.instrumentId,
      side: order.side,
      quantity: fillQty,
      price,
      fee: fee.amount,
      currency: instrument.currency,
      // 建玉と同じ資金区分を伝播（portfolio が CASH/MARGIN を振り分ける）。
      // CASH/未指定の現物は marginType を載せず後方互換に保つ。
      ...(order.marginType === "MARGIN"
        ? { marginType: "MARGIN" as const }
        : {}),
      executedAt: now.toISOString(),
    };

    const newFilled = order.filledQuantity + fillQty;
    const status: Order["status"] =
      newFilled >= order.quantity ? "FILLED" : "PARTIALLY_FILLED";
    const updated: Order = {
      ...order,
      filledQuantity: newFilled,
      status,
      updatedAt: now.toISOString(),
    };
    await this.orders.update(updated);
    if (status === "FILLED") this.triggered.delete(order.id);

    return trade;
  }

  /** STOP / STOP_LIMIT のトリガ判定。トリガ済みなら true を維持。 */
  private evaluateTrigger(order: Order, marketPrice: string): boolean {
    if (order.type !== "STOP" && order.type !== "STOP_LIMIT") return false;
    if (this.triggered.has(order.id)) return true;
    if (order.stopPrice === undefined) return false;

    const market = new Decimal(marketPrice);
    const stop = new Decimal(order.stopPrice);
    // 買い逆指値: 価格が stop 以上で発動。売り逆指値: 価格が stop 以下で発動。
    const fired =
      order.side === "BUY"
        ? market.greaterThanOrEqualTo(stop)
        : market.lessThanOrEqualTo(stop);
    if (fired) this.triggered.add(order.id);
    return fired;
  }

  /** DAY 注文の当日失効判定（UTC 日付が発注日より後）。 */
  private isExpired(order: Order, now: Date): boolean {
    const created = new Date(order.createdAt);
    const createdDay = created.toISOString().slice(0, 10);
    const nowDay = now.toISOString().slice(0, 10);
    return nowDay > createdDay;
  }

  /** 現金（買い）/ 保有（売り）の事前チェック。 */
  private async assertAffordable(
    cmd: PlaceOrderCommand,
    instrument: Instrument,
    limitPrice: string | undefined,
  ): Promise<void> {
    if (cmd.side === "SELL") {
      const held = await this.accountState.getPositionQuantity(
        cmd.accountId,
        cmd.instrumentId,
      );
      if (cmd.quantity > held) {
        throw new DomainError(
          "INSUFFICIENT_POSITION",
          `sell ${cmd.quantity} exceeds position ${held}`,
        );
      }
      return;
    }

    // BUY: 見積コスト（指値があれば指値、なければ最新気配でなく保守的に限度不明→スキップ）。
    // MARKET 買いは事前に正確なコストが出せないため、指値系のみ厳密チェックする。
    const refPrice = limitPrice ?? cmd.limitPrice;
    if (refPrice === undefined) return;

    const estCost = Money.notional(refPrice, cmd.quantity, instrument.currency);
    const cashAmount = await this.accountState.getAvailableCash(
      cmd.accountId,
      instrument.currency,
    );
    const cash = Money.money(cashAmount, instrument.currency);
    // estCost > cash なら不足。
    if (Money.compare(estCost, cash) > 0) {
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        `estimated cost ${estCost.amount} exceeds cash ${cash.amount}`,
      );
    }
  }

  /**
   * 信用建ての事前チェック（spec §2.2 P2）。
   *
   * 1. MarginPolicyProvider で銘柄ポリシーを解決。null（信用不可）なら拒否。
   * 2. MarginRequirement（notional × initialMarginRate）を組み、利用可能保証金
   *    （現金余力）と突き合わせる。不足は INSUFFICIENT_FUNDS。
   *
   * ショート（SELL × MARGIN）は現物の保有数量チェックを通さず、保証金のみで判定する。
   * MARKET は約定価格未確定のため、現状は事前の保証金チェックを行わない
   *（指値系のみ厳密チェック。CASH 現物の MARKET 買いと同方針。B5 で予算上限が入れば厳密化可能）。
   */
  private async assertMarginAffordable(
    cmd: PlaceOrderCommand,
    instrument: Instrument,
    limitPrice: string | undefined,
  ): Promise<void> {
    const policy = await this.resolveMarginPolicy(cmd.instrumentId);

    // 約定価格未確定（MARKET）の場合は事前保証金チェックをスキップ（指値系のみ厳密化）。
    const refPrice = limitPrice ?? cmd.limitPrice;
    if (refPrice === undefined) return;

    const requirement = computeMarginRequirement({
      quantity: cmd.quantity,
      price: refPrice,
      policy,
      currency: instrument.currency,
    });

    const availableMargin = await this.accountState.getAvailableCash(
      cmd.accountId,
      instrument.currency,
    );
    if (
      !hasSufficientMargin(
        requirement.requiredMargin,
        availableMargin,
        instrument.currency,
      )
    ) {
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        `required margin ${requirement.requiredMargin} exceeds available ${availableMargin}`,
      );
    }
  }

  /** 銘柄の信用ポリシーを解決。プロバイダ未注入 or null（信用不可）なら拒否する。 */
  private async resolveMarginPolicy(
    instrumentId: string,
  ): Promise<MarginPolicy> {
    if (!this.marginPolicy) {
      throw new DomainError(
        "VALIDATION",
        "margin trading is not configured (no MarginPolicyProvider)",
      );
    }
    const policy = await this.marginPolicy.getMarginPolicy(instrumentId);
    if (!policy) {
      throw new DomainError(
        "VALIDATION",
        `margin trading is not allowed for instrument: ${instrumentId}`,
      );
    }
    return policy;
  }

  /**
   * 信用建玉に対する金利/貸株料の日次計上を 1 件算出する（純粋・副作用なし。spec §5.1）。
   *
   * principal × annualRate × days / 365 を費用（負の現金移動）として返す。経過日数は
   * 直近計上時刻 `lastAccruedAt`（無ければ建玉開始 `openedAt`）から `now` までの UTC 日数差。
   * 建玉の年利は LONG=買い建て金利、SHORT=貸株料（無ければ買い建て金利）を適用する。
   *
   * 責務分界（domain-architect 申し送り準拠）: 本メソッドは契約形の InterestAccrual を
   * 返すだけで状態を持たない。CashLedger(INTEREST|BORROW_FEE) への記帳・Position.margin の
   * accruedInterest/lastAccruedAt 更新は **portfolio** が行う（IF 越し。直接 import しない）。
   */
  accrueInterest(input: {
    accountId: string;
    positionId: string;
    instrumentId: string;
    side: PositionSide;
    /** 建玉の総代金（principal）。 */
    principal: string;
    currency: Instrument["currency"];
    policy: MarginPolicy;
    /** 直近計上時刻（無ければ建玉開始時刻 openedAt）。 */
    lastAccruedAt: Date;
    /** 計上対象時刻（UTC）。既定は注入クロック。 */
    now?: Date;
  }): InterestAccrual {
    const now = input.now ?? this.clock();
    const days = daysBetween(input.lastAccruedAt, now);
    return computeInterestAccrual({
      id: this.generateId(),
      accountId: input.accountId,
      positionId: input.positionId,
      instrumentId: input.instrumentId,
      side: input.side,
      principal: input.principal,
      annualRate: annualRateForSide(input.side, input.policy),
      days,
      currency: input.currency,
      accruedAt: now,
    });
  }
}
