import Decimal from "decimal.js";
import type {
  AgentAction,
  AgentDecision,
  AgentObservation,
  AgentProfile,
  AgentTradingService as IAgentTradingService,
  Order,
  PortfolioService,
  PriceProvider,
  RiskGuard,
  TradingEngine,
} from "@stonks/contracts";
import { DefaultRiskGuard, type RiskState } from "./risk-guard.js";
import type { AgentDecisionRepository } from "./repository.js";

/** AgentProfile を取得する最小 IF（db 非依存）。 */
export interface AgentProfileProvider {
  getProfile(agentProfileId: string): Promise<AgentProfile | null>;
}

/** 単調増加 ID 生成器（テスト決定性のため注入可能）。 */
export type IdFactory = () => string;

/** RiskGuard を AgentProfile の制限から組み立てるファクトリ（差し替え可能）。 */
export type RiskGuardFactory = (
  profile: AgentProfile,
  state: RiskState,
) => RiskGuard;

export interface AgentTradingServiceDeps {
  profiles: AgentProfileProvider;
  portfolio: PortfolioService;
  priceProvider: PriceProvider;
  tradingEngine: TradingEngine;
  decisions: AgentDecisionRepository;
  /** 監査 ID 生成（省略時は連番）。 */
  newId?: IdFactory;
  /** 現在時刻（テスト決定性のため注入可能）。 */
  now?: () => Date;
  /** RiskGuard 生成（省略時は DefaultRiskGuard）。 */
  riskGuardFactory?: RiskGuardFactory;
}

const ZERO = new Decimal(0);

/** UTC 日付キー（日次累計の区切り）。 */
const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * AI エージェント取引サービス（spec §6.6 / §2.7 / §5.2 不変条件）。
 *
 * submitDecision は監査証跡の欠落を絶対に許さない:
 * 1. rationale 付き AgentDecision を **必ず先に記録**する。
 * 2. AgentProfile.enabled / riskLimits を RiskGuard で各 ORDER アクションごとに検証。
 * 3. 通過したアクションだけを TradingEngine IF へ委譲して発注。
 * 4. 生成された Order の id を decision.resultOrderIds にひも付けて永続化・返却。
 *
 * 発注は TradingEngine IF、状態は PortfolioService IF、価格は PriceProvider IF 経由のみ。
 * これらドメインパッケージを直接 import しない（CLAUDE.md §0 / §4.3 / §8）。
 */
export class DefaultAgentTradingService implements IAgentTradingService {
  private readonly profiles: AgentProfileProvider;
  private readonly portfolio: PortfolioService;
  private readonly price: PriceProvider;
  private readonly engine: TradingEngine;
  private readonly decisions: AgentDecisionRepository;
  private readonly newId: IdFactory;
  private readonly now: () => Date;
  private readonly makeRiskGuard: RiskGuardFactory;
  private seq = 0;
  /** 口座×UTC日付 -> 当日発注済み累計金額（基軸）。日次上限の判定に使う。 */
  private readonly dailyNotional = new Map<string, Decimal>();

  constructor(deps: AgentTradingServiceDeps) {
    this.profiles = deps.profiles;
    this.portfolio = deps.portfolio;
    this.price = deps.priceProvider;
    this.engine = deps.tradingEngine;
    this.decisions = deps.decisions;
    this.newId = deps.newId ?? (() => `ag-${++this.seq}`);
    this.now = deps.now ?? (() => new Date());
    this.makeRiskGuard =
      deps.riskGuardFactory ??
      ((profile, state) =>
        new DefaultRiskGuard({ limits: profile.riskLimits, state }));
  }

  async submitDecision(input: {
    agentProfileId: string;
    accountId: string;
    rationale: string;
    actions: AgentAction[];
    inputContext: unknown;
  }): Promise<{ decisionId: string; orders: Order[] }> {
    // rationale は監査証跡の核。空は受理しない（spec §5.2）。
    if (input.rationale.trim().length === 0) {
      throw new Error("rationale is required for every AgentDecision");
    }

    const at = this.now();
    const profile = await this.profiles.getProfile(input.agentProfileId);
    if (!profile) {
      throw new Error(`agent profile not found: ${input.agentProfileId}`);
    }

    // 1. 監査証跡を**先に**確定して記録する（発注の成否に関わらず欠落させない）。
    const decision: AgentDecision = {
      id: this.newId(),
      agentProfileId: input.agentProfileId,
      accountId: input.accountId,
      ts: at.toISOString(),
      model: profile.model,
      inputContext: input.inputContext,
      rationale: input.rationale,
      proposedActions: input.actions,
      resultOrderIds: [],
    };
    await this.decisions.saveDecision(decision);

    // enabled=false のエージェントは発注しない。decision は記録済み（監査用）。
    if (!profile.enabled) {
      return { decisionId: decision.id, orders: [] };
    }

    // 2. RiskGuard 用の同期スナップショットを構築（ルックアヘッド防止のため at 時点の状態）。
    const state = await this.buildRiskState(input.accountId, at, input.actions);
    const guard = this.makeRiskGuard(profile, state);

    // 3. 各アクションを検証し、通過分のみ TradingEngine へ委譲。
    const orders: Order[] = [];
    const dayKey = `${input.accountId}:${utcDayKey(at)}`;
    for (const action of input.actions) {
      const verdict = guard.check(input.accountId, action);
      if (!verdict.ok) {
        continue; // 違反アクションは発注しない（監査ログには proposedActions として残る）。
      }
      if (action.kind === "ORDER") {
        const order = await this.engine.placeOrder(action.order);
        orders.push(order);
        // 日次累計を更新（後続アクションの maxDailyNotional 判定に反映）。
        const n = state.notional(action);
        if (n) {
          this.dailyNotional.set(
            dayKey,
            (this.dailyNotional.get(dayKey) ?? ZERO).plus(n),
          );
        }
      } else if (action.kind === "CANCEL") {
        const order = await this.engine.cancelOrder(action.orderId);
        orders.push(order);
      }
      // HOLD は発注なし。
    }

    // 4. 生成 Order を decision にひも付けて更新（resultOrderIds）。
    if (orders.length > 0) {
      decision.resultOrderIds = orders.map((o) => o.id);
      await this.decisions.saveDecision(decision);
    }

    return { decisionId: decision.id, orders };
  }

  async buildObservation(accountId: string): Promise<AgentObservation> {
    const at = this.now();
    const summary = await this.portfolio.getSummary(accountId);
    const positions = await this.portfolio.getPositions(accountId);

    const observationPositions: AgentObservation["positions"] = [];
    const recentQuotes: AgentObservation["recentQuotes"] = [];
    for (const p of positions) {
      observationPositions.push({
        instrumentId: p.instrumentId,
        symbol: p.instrumentId, // symbol は instrument 解決前のフォールバック。
        quantity: p.quantity,
        marketPrice: p.marketPrice,
        unrealizedPnlPct: p.unrealizedPnlPct,
      });
      recentQuotes.push({
        instrumentId: p.instrumentId,
        symbol: p.instrumentId,
        last: p.marketPrice,
      });
    }

    return {
      accountId,
      asOf: at.toISOString(),
      cashByCurrency: { [summary.baseCurrency]: summary.cash.amount },
      positions: observationPositions,
      recentQuotes,
    };
  }

  /**
   * RiskGuard が同期参照する口座状態スナップショットを構築する。
   * 価格は PriceProvider、保有・総資産は PortfolioService 経由（直接 import しない）。
   */
  private async buildRiskState(
    accountId: string,
    at: Date,
    actions: AgentAction[],
  ): Promise<RiskState> {
    const summary = await this.portfolio.getSummary(accountId);
    const equity = new Decimal(summary.equity.amount);
    const cash = new Decimal(summary.cash.amount);

    // 銘柄ごとの現在評価額（集中度の分子の素）。
    const positions = await this.portfolio.getPositions(accountId);
    const marketValueByInstrument = new Map<string, Decimal>();
    for (const p of positions) {
      marketValueByInstrument.set(
        p.instrumentId,
        new Decimal(p.marketValue.amount),
      );
    }

    // ORDER アクションが参照する銘柄の時価を at 時点で先読みして同期スナップショットに固める
    // （RiskGuard.check は同期 IF・ルックアヘッド禁止）。
    const marketPrice = new Map<string, Decimal>();
    for (const action of actions) {
      if (action.kind !== "ORDER") continue;
      const id = action.order.instrumentId;
      if (marketPrice.has(id)) continue;
      try {
        const px = await this.price.getLatestPrice(id, at);
        marketPrice.set(id, new Decimal(px.amount));
      } catch {
        // 価格不明の銘柄は notional=null となり RiskGuard が拒否する。
      }
    }

    const dayKey = `${accountId}:${utcDayKey(at)}`;
    const dailyNotional = this.dailyNotional;

    /** 想定約定単価: LIMIT/STOP_LIMIT は指値、それ以外は時価。 */
    const estPrice = (action: Extract<AgentAction, { kind: "ORDER" }>):
      | Decimal
      | null => {
      const { order } = action;
      if (
        (order.type === "LIMIT" || order.type === "STOP_LIMIT") &&
        order.limitPrice !== undefined
      ) {
        return new Decimal(order.limitPrice);
      }
      return marketPrice.get(order.instrumentId) ?? null;
    };

    return {
      notional(action: AgentAction): Decimal | null {
        if (action.kind !== "ORDER") return null;
        const px = estPrice(action);
        if (px === null) return null;
        return px.times(action.order.quantity);
      },
      availableCash(action: AgentAction): Decimal | null {
        if (action.kind !== "ORDER") return null;
        return cash;
      },
      positionPctAfter(action: AgentAction): number | null {
        if (action.kind !== "ORDER") return null;
        const px = estPrice(action);
        if (px === null) return null;
        const { order } = action;
        const current =
          marketValueByInstrument.get(order.instrumentId) ?? ZERO;
        const delta = px.times(order.quantity);
        // BUY は集中度が増える方向。SELL は減る方向で評価する。
        // 総資産は売買で概ね不変（現金⇔評価額の振替）なので equity をそのまま使う。
        const after =
          order.side === "BUY" ? current.plus(delta) : current.minus(delta);
        if (equity.lte(ZERO)) return null;
        return Decimal.max(after, ZERO).dividedBy(equity).toNumber();
      },
      dailyNotionalSoFar(): Decimal {
        return dailyNotional.get(dayKey) ?? ZERO;
      },
    };
  }
}
