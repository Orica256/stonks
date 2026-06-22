import Decimal from "decimal.js";
import { isValidLot, Money, roundToTick } from "@stonks/core-domain";
import {
  DomainError,
  PlaceBracketOrderCommand as PlaceBracketOrderCommandSchema,
  PlaceOrderCommand as PlaceOrderCommandSchema,
} from "@stonks/contracts";
import type {
  FeeModel,
  Instrument,
  InterestAccrual,
  MarginPolicy,
  MarginPolicyProvider,
  Order,
  OrderActivation,
  OrderLinkType,
  PlaceBracketOrderCommand,
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
import type { SlippageFillModel } from "./fill-model.js";
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
    const order = await this.buildValidatedOrder(cmd);
    await this.orders.save(order);
    return order;
  }

  /**
   * `PlaceOrderCommand` を Zod 検証し、単元/呼値ルール＋資金事前チェックを通した上で
   * `Order`（PENDING）を構築する（保存はしない）。単発・複合（OCO/IFD/bracket）の
   * 各脚で共通利用する。`link` を渡すと複合注文の link フィールドを付与する。
   *
   * `activation === "WAITING"`（IFD/bracket 子）は親約定まで休眠＝資金が拘束されないため、
   * 発注時点の事前チェック（資金/保有）はスキップする。発効（ACTIVE 化）後に
   * `evaluateOpenOrders` が約定時の不変条件で評価する。
   */
  private async buildValidatedOrder(
    cmd: PlaceOrderCommand,
    link?: {
      linkGroupId?: string;
      linkType?: OrderLinkType;
      parentOrderId?: string;
      activation?: OrderActivation;
    },
  ): Promise<Order> {
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

    // WAITING（IFD/bracket 子）は休眠中で資金未拘束のため事前チェックを保留する。
    const waiting = link?.activation === "WAITING";
    if (!waiting) {
      if (isMargin) {
        // 信用: 銘柄ポリシーを解決し（null=信用不可→拒否）、必要保証金を充足判定する。
        // ショート（SELL × MARGIN）は現物の保有数量チェックを通さず別ルートで建てる。
        await this.assertMarginAffordable(command, instrument, limitPrice);
      } else {
        // 現物: 現金（買い）/ 保有（売り）の事前チェック。
        await this.assertAffordable(command, instrument, limitPrice);
      }
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
      // 複合注文の link フィールド（未指定の単発は付与せず従来挙動）。
      ...(link?.linkGroupId !== undefined ? { linkGroupId: link.linkGroupId } : {}),
      ...(link?.linkType !== undefined ? { linkType: link.linkType } : {}),
      ...(link?.parentOrderId !== undefined
        ? { parentOrderId: link.parentOrderId }
        : {}),
      ...(link?.activation !== undefined ? { activation: link.activation } : {}),
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    };

    return order;
  }

  /**
   * 複合注文（OCO / IFD / bracket）の発注（spec §2.2 P2。Phase 5）。
   *
   * 各 leg/parent/child を `PlaceOrderCommand` として個別検証し、link フィールドを張った
   * `Order` 群を作成・保存して返す。検証失敗・銘柄不在・単元/資金違反は `DomainError`。
   * 1 脚でも検証/事前チェックに失敗したら、どの注文も保存せず全体を弾く（all-or-nothing）。
   *
   * - OCO: 2 脚に共通 `linkGroupId`＋`linkType="OCO"`・両 `activation="ACTIVE"`。
   * - IFD: 親 ACTIVE、子（1 本以上）に `parentOrderId=親id`＋`linkType="IFD"`＋`WAITING`。
   * - BRACKET: 親 ACTIVE、子 2 本に共通 `linkGroupId`(OCO)＋`parentOrderId=親id`＋
   *   `linkType="OCO"`＋`WAITING`（親約定→子発効→子の片約定で他方取消）。
   */
  async placeBracketOrder(cmd: PlaceBracketOrderCommand): Promise<Order[]> {
    const parsed = PlaceBracketOrderCommandSchema.safeParse(cmd);
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION",
        "invalid PlaceBracketOrderCommand",
        parsed.error.issues,
      );
    }
    const command = parsed.data;

    // 各脚は z.unknown() なので PlaceOrderCommand として個別に再検証する（price 妥当性等）。
    const asLeg = (raw: unknown): PlaceOrderCommand => raw as PlaceOrderCommand;

    let built: Order[];
    if (command.kind === "OCO") {
      const linkGroupId = this.generateId();
      const [a, b] = command.legs;
      // 検証は buildValidatedOrder 内で行う。失敗時は例外で全体中止（未保存）。
      const o1 = await this.buildValidatedOrder(asLeg(a), {
        linkGroupId,
        linkType: "OCO",
        activation: "ACTIVE",
      });
      const o2 = await this.buildValidatedOrder(asLeg(b), {
        linkGroupId,
        linkType: "OCO",
        activation: "ACTIVE",
      });
      built = [o1, o2];
    } else if (command.kind === "IFD") {
      const parent = await this.buildValidatedOrder(asLeg(command.parent), {
        linkType: "IFD",
        activation: "ACTIVE",
      });
      const children: Order[] = [];
      for (const child of command.children) {
        children.push(
          await this.buildValidatedOrder(asLeg(child), {
            parentOrderId: parent.id,
            linkType: "IFD",
            activation: "WAITING",
          }),
        );
      }
      built = [parent, ...children];
    } else {
      // BRACKET: 親 IFD・子 2 本は共通 linkGroupId(OCO)＋共通 parentOrderId(親)。
      const parent = await this.buildValidatedOrder(asLeg(command.parent), {
        linkType: "IFD",
        activation: "ACTIVE",
      });
      const linkGroupId = this.generateId();
      const [c1, c2] = command.children;
      const child1 = await this.buildValidatedOrder(asLeg(c1), {
        linkGroupId,
        linkType: "OCO",
        parentOrderId: parent.id,
        activation: "WAITING",
      });
      const child2 = await this.buildValidatedOrder(asLeg(c2), {
        linkGroupId,
        linkType: "OCO",
        parentOrderId: parent.id,
        activation: "WAITING",
      });
      built = [parent, child1, child2];
    }

    // 全脚の検証を通過してからまとめて保存（all-or-nothing）。
    for (const order of built) {
      await this.orders.save(order);
    }
    return built;
  }

  /**
   * 複合注文グループ単位の取消（spec §2.2 P2。Phase 5）。
   *
   * `linkGroupId` に属するオープン注文（PENDING / PARTIALLY_FILLED）と、休眠中の
   * WAITING 子を一括 CANCELLED にする。約定済み/取消済み等の終端状態は据え置く。
   * 取消した注文（更新後）を返す。
   */
  async cancelOrderGroup(linkGroupId: string): Promise<Order[]> {
    const group = await this.orders.findByLinkGroupId(linkGroupId);
    const cancelled: Order[] = [];
    const now = this.clock().toISOString();
    for (const order of group) {
      // オープン（PENDING/PARTIALLY_FILLED）または休眠中（WAITING）を取消対象とする。
      const isOpen = OPEN_STATUSES.has(order.status);
      const isWaiting = order.activation === "WAITING";
      if (!isOpen && !isWaiting) continue;
      const updated: Order = {
        ...order,
        status: "CANCELLED",
        updatedAt: now,
      };
      await this.orders.update(updated);
      this.triggered.delete(order.id);
      cancelled.push(updated);
    }
    return cancelled;
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
    // 親注文を取消したら、未発効の WAITING 子も連動 CANCELLED（孤児防止。Phase 5）。
    await this.cancelWaitingChildren(orderId, this.clock());
    return updated;
  }

  /** オープン注文を価格で評価し、約定（Trade）を生成する。DAY は当日中に失効。 */
  async evaluateOpenOrders(ctx: {
    now: Date;
    priceProvider: PriceProvider;
  }): Promise<Trade[]> {
    const open = await this.orders.findOpen();
    const trades: Trade[] = [];

    for (const snapshot of open) {
      // 同一パス内の先行約定がカスケード（OCO 取消・IFD 発効）でこの注文を
      // 変化させている可能性があるため、評価直前に最新状態を読み直す。
      const order = (await this.orders.findById(snapshot.id)) ?? snapshot;

      // 先行カスケードで終端状態になっていれば評価しない（OCO 取消済み等）。
      if (!OPEN_STATUSES.has(order.status)) continue;

      // WAITING（IFD/bracket 子）は親約定までエンジン評価から除外（休眠）。
      // 同一パス内で親が約定し子が ACTIVE 化しても、このパスでは約定させない
      //（発効は次パスから有効）。そのためパス開始時スナップショットの activation で判定する。
      if (snapshot.activation === "WAITING" || order.activation === "WAITING") {
        continue;
      }

      // DAY 失効: 発注日（UTC 日付）より後なら EXPIRED。
      if (order.timeInForce === "DAY" && this.isExpired(order, ctx.now)) {
        await this.orders.update({
          ...order,
          status: "EXPIRED",
          updatedAt: ctx.now.toISOString(),
        });
        this.triggered.delete(order.id);
        // 親が EXPIRED したら未発効の WAITING 子も連動 CANCELLED（孤児防止）。
        await this.cancelWaitingChildren(order.id, ctx.now);
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

    // 複合注文カスケード（spec §2.2 P2。Phase 5）。
    // 約定（FILLED または「最初の」部分約定。filledQuantity が 0→正に変わった瞬間）で発火。
    const isFirstFill = order.filledQuantity === 0 && newFilled > 0;
    if (isFirstFill) {
      await this.cascadeOnFill(updated, now);
    }

    return trade;
  }

  /**
   * 約定確定時の複合注文カスケード（Phase 5）。
   * (a) OCO: 同 `linkGroupId` の他注文を CANCELLED（自身は除く）。
   * (b) IFD: 約定注文を親に持つ WAITING 子を `activation="ACTIVE"` に発効。
   * bracket は親約定で子 2 本が ACTIVE 化し、後に子の片約定で (a) が連鎖する。
   */
  private async cascadeOnFill(filled: Order, now: Date): Promise<void> {
    // (a) OCO: 同グループの他注文を取消す（オープン/WAITING のみ。終端状態は据え置き）。
    if (filled.linkGroupId !== undefined) {
      const group = await this.orders.findByLinkGroupId(filled.linkGroupId);
      for (const other of group) {
        if (other.id === filled.id) continue;
        const isOpen = OPEN_STATUSES.has(other.status);
        const isWaiting = other.activation === "WAITING";
        if (!isOpen && !isWaiting) continue;
        await this.orders.update({
          ...other,
          status: "CANCELLED",
          updatedAt: now.toISOString(),
        });
        this.triggered.delete(other.id);
      }
    }

    // (b) IFD: 約定注文を親に持つ WAITING 子を ACTIVE に発効させる。
    const children = await this.orders.findByParentOrderId(filled.id);
    for (const child of children) {
      if (child.activation !== "WAITING") continue;
      if (!OPEN_STATUSES.has(child.status)) continue;
      await this.orders.update({
        ...child,
        activation: "ACTIVE",
        updatedAt: now.toISOString(),
      });
    }
  }

  /**
   * 親が EXPIRED/CANCELLED された際に、未発効の WAITING 子を連動 CANCELLED する（Phase 5）。
   * 親約定前に親が失効/取消されると子は永遠に発効しないため、孤児化を防ぐ。
   */
  private async cancelWaitingChildren(
    parentOrderId: string,
    now: Date,
  ): Promise<void> {
    const children = await this.orders.findByParentOrderId(parentOrderId);
    for (const child of children) {
      if (child.activation !== "WAITING") continue;
      if (!OPEN_STATUSES.has(child.status)) continue;
      await this.orders.update({
        ...child,
        status: "CANCELLED",
        updatedAt: now.toISOString(),
      });
      this.triggered.delete(child.id);
    }
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
