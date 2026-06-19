import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AgentAction, RiskLimits } from "@stonks/contracts";
import { DefaultRiskGuard, type RiskState } from "./risk-guard.js";

const order = (over: Partial<{
  side: "BUY" | "SELL";
  quantity: number;
}> = {}): AgentAction => ({
  kind: "ORDER",
  order: {
    accountId: "acc",
    instrumentId: "i-1",
    side: over.side ?? "BUY",
    type: "MARKET",
    quantity: over.quantity ?? 10,
    timeInForce: "DAY",
  },
});

/** 固定値を返す RiskState（各上限を個別に検証するため）。 */
const state = (cfg: {
  notional?: number;
  cash?: number;
  positionPct?: number | null;
  daily?: number;
}): RiskState => ({
  notional: () =>
    cfg.notional === undefined ? null : new Decimal(cfg.notional),
  availableCash: () =>
    cfg.cash === undefined ? null : new Decimal(cfg.cash),
  positionPctAfter: () =>
    cfg.positionPct === undefined ? null : cfg.positionPct,
  dailyNotionalSoFar: () => new Decimal(cfg.daily ?? 0),
});

const guard = (limits: RiskLimits, s: RiskState) =>
  new DefaultRiskGuard({ limits, state: s });

describe("RiskGuard.check", () => {
  it("CANCEL / HOLD は常に許可", () => {
    const g = guard({}, state({}));
    expect(g.check("acc", { kind: "CANCEL", orderId: "o" }).ok).toBe(true);
    expect(g.check("acc", { kind: "HOLD" }).ok).toBe(true);
  });

  it("maxOrderNotional: 上限超過を拒否、上限内を許可", () => {
    const g = guard(
      { maxOrderNotional: "10000" },
      state({ notional: 10001, cash: 1e9, positionPct: 0 }),
    );
    expect(g.check("acc", order()).ok).toBe(false);

    const g2 = guard(
      { maxOrderNotional: "10000" },
      state({ notional: 10000, cash: 1e9, positionPct: 0 }),
    );
    expect(g2.check("acc", order()).ok).toBe(true);
  });

  it("maxDailyNotional: 当日累計 + 本注文が上限を超えると拒否", () => {
    const g = guard(
      { maxDailyNotional: "15000" },
      state({ notional: 6000, cash: 1e9, positionPct: 0, daily: 10000 }),
    );
    // 10000 + 6000 = 16000 > 15000
    expect(g.check("acc", order()).ok).toBe(false);

    const g2 = guard(
      { maxDailyNotional: "15000" },
      state({ notional: 5000, cash: 1e9, positionPct: 0, daily: 10000 }),
    );
    expect(g2.check("acc", order()).ok).toBe(true);
  });

  it("maxPositionPct: 約定後集中度が上限超過なら拒否", () => {
    const g = guard(
      { maxPositionPct: 0.3 },
      state({ notional: 1000, cash: 1e9, positionPct: 0.31 }),
    );
    expect(g.check("acc", order()).ok).toBe(false);

    const g2 = guard(
      { maxPositionPct: 0.3 },
      state({ notional: 1000, cash: 1e9, positionPct: 0.3 }),
    );
    expect(g2.check("acc", order()).ok).toBe(true);
  });

  it("現金不足: BUY の必要金額が利用可能現金を超えると拒否", () => {
    const g = guard(
      {},
      state({ notional: 10000, cash: 9999, positionPct: 0 }),
    );
    expect(g.check("acc", order({ side: "BUY" })).ok).toBe(false);
  });

  it("SELL は現金チェック対象外", () => {
    const g = guard(
      {},
      state({ notional: 10000, cash: 0, positionPct: 0 }),
    );
    expect(g.check("acc", order({ side: "SELL" })).ok).toBe(true);
  });

  it("価格不明(notional=null)は拒否", () => {
    const g = guard({ maxOrderNotional: "10000" }, state({}));
    const v = g.check("acc", order());
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/notional/);
  });

  it("上限未設定なら該当チェックは無効（現金のみで判定）", () => {
    const g = guard({}, state({ notional: 1e9, cash: 1e12, positionPct: 1 }));
    expect(g.check("acc", order()).ok).toBe(true);
  });
});
