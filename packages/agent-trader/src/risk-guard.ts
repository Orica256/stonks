import Decimal from "decimal.js";
import type { AgentAction, RiskGuard, RiskLimits } from "@stonks/contracts";

/**
 * RiskGuard.check に渡すための、評価時点の口座状態スナップショット。
 *
 * contracts の `RiskGuard.check` は同期・引数が (accountId, action) のみのため、
 * 現金・集中度・日次累計といった状態は呼び出し側（AgentTradingService）が
 * 事前に同期スナップショットとして注入する。これにより契約の形状を変えずに
 * 「ルックアヘッドなし・状態依存」のガードを実現する。
 */
export interface RiskState {
  /** 評価対象アクションの想定約定金額（基軸）。MARKET は時価、LIMIT は指値で見積もる。 */
  notional(action: AgentAction): Decimal | null;
  /** 当該注文に使う通貨で利用可能な現金（基軸換算後）。 */
  availableCash(action: AgentAction): Decimal | null;
  /** 約定後に当該銘柄が口座総資産に占める想定比率（0..1）。 */
  positionPctAfter(action: AgentAction): number | null;
  /** 当日（UTC 日付）に既に発注済みの累計金額（基軸）。 */
  dailyNotionalSoFar(): Decimal;
}

export interface RiskGuardDeps {
  limits: RiskLimits;
  state: RiskState;
}

const ZERO = new Decimal(0);

/**
 * 暴走防止のリスクガード（spec §2.7 P1 / §9 / §5.2 不変条件）。
 *
 * 評価対象は ORDER アクションのみ。CANCEL / HOLD は常に許可する
 * （リスクを増やさないため）。各上限は RiskLimits で未設定なら無効化。
 *
 * チェック項目:
 * - maxOrderNotional: 1 注文あたりの最大発注金額。
 * - maxDailyNotional: 当日累計 + 本注文が日次上限を超えないこと。
 * - maxPositionPct:   約定後の 1 銘柄集中度が上限以下であること。
 * - 現金不足:          買い注文の必要現金が利用可能現金を超えないこと。
 */
export class DefaultRiskGuard implements RiskGuard {
  private readonly limits: RiskLimits;
  private readonly state: RiskState;

  constructor(deps: RiskGuardDeps) {
    this.limits = deps.limits;
    this.state = deps.state;
  }

  check(
    _accountId: string,
    action: AgentAction,
  ): { ok: boolean; reason?: string } {
    if (action.kind !== "ORDER") {
      return { ok: true };
    }

    const notional = this.state.notional(action);
    if (notional === null) {
      return { ok: false, reason: "notional unavailable (no price)" };
    }
    if (notional.lt(ZERO)) {
      return { ok: false, reason: "notional must be >= 0" };
    }

    // 1 注文上限
    if (this.limits.maxOrderNotional !== undefined) {
      const max = new Decimal(this.limits.maxOrderNotional);
      if (notional.gt(max)) {
        return {
          ok: false,
          reason: `order notional ${notional.toString()} exceeds maxOrderNotional ${max.toString()}`,
        };
      }
    }

    // 1 日上限（当日累計 + 本注文）
    if (this.limits.maxDailyNotional !== undefined) {
      const max = new Decimal(this.limits.maxDailyNotional);
      const projected = this.state.dailyNotionalSoFar().plus(notional);
      if (projected.gt(max)) {
        return {
          ok: false,
          reason: `daily notional ${projected.toString()} exceeds maxDailyNotional ${max.toString()}`,
        };
      }
    }

    // 買い注文の現金不足チェック
    if (action.order.side === "BUY") {
      const cash = this.state.availableCash(action);
      if (cash === null) {
        return { ok: false, reason: "available cash unavailable" };
      }
      if (notional.gt(cash)) {
        return {
          ok: false,
          reason: `insufficient cash: need ${notional.toString()} have ${cash.toString()}`,
        };
      }
    }

    // 集中度（約定後の 1 銘柄比率）
    if (this.limits.maxPositionPct !== undefined) {
      const pct = this.state.positionPctAfter(action);
      if (pct === null) {
        return { ok: false, reason: "position concentration unavailable" };
      }
      if (pct > this.limits.maxPositionPct) {
        return {
          ok: false,
          reason: `position concentration ${pct.toFixed(4)} exceeds maxPositionPct ${this.limits.maxPositionPct}`,
        };
      }
    }

    return { ok: true };
  }
}
