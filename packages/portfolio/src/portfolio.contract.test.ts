import { describe, expect, it } from "vitest";
import {
  CapitalGainsTaxEstimate,
  EquityPoint,
  PortfolioSummary,
  PositionView,
  RealizedPnl,
  Trade,
  type PortfolioService,
} from "@stonks/contracts";
import { DefaultPortfolioService } from "./portfolio-service.js";
import { InMemoryPortfolioRepository } from "./in-memory-repository.js";
import { FakeFxProvider, FakePriceProvider } from "./fakes.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）。
 * 公開実装が contracts の PortfolioService に一致し、出力が各スキーマに通ることを保証する。
 */
const build = (): PortfolioService => {
  return new DefaultPortfolioService({
    repository: new InMemoryPortfolioRepository(),
    priceProvider: new FakePriceProvider({
      "i-1": { amount: "1200", currency: "JPY" },
    }),
    fxProvider: new FakeFxProvider("150"),
    baseCurrency: "JPY",
  });
};

describe("PortfolioService 契約遵守", () => {
  it("DefaultPortfolioService は PortfolioService を実装する", () => {
    const svc: PortfolioService = build();
    expect(typeof svc.applyTrade).toBe("function");
    expect(typeof svc.getPositions).toBe("function");
    expect(typeof svc.getSummary).toBe("function");
    expect(typeof svc.getHistory).toBe("function");
    expect(typeof svc.deposit).toBe("function");
    expect(typeof svc.withdraw).toBe("function");
    expect(typeof svc.getTrades).toBe("function");
    expect(typeof svc.getRealizedPnl).toBe("function");
    // Phase 3: 譲渡益課税の概算（optional IF を実装に格上げ）。
    expect(typeof svc.estimateCapitalGainsTax).toBe("function");
  });

  it("出力は PositionView / PortfolioSummary / EquityPoint スキーマに通る", async () => {
    const svc = build();
    await svc.deposit("a", { amount: "1000000", currency: "JPY" });
    await svc.applyTrade({
      id: "t1",
      orderId: "o1",
      accountId: "a",
      instrumentId: "i-1",
      side: "BUY",
      quantity: 100,
      price: "1000",
      fee: "100",
      currency: "JPY",
      executedAt: "2026-06-19T00:00:00.000Z",
    });

    const positions = await svc.getPositions("a");
    expect(positions).toHaveLength(1);
    expect(PositionView.parse(positions[0])).toBeTruthy();

    const summary = await svc.getSummary("a");
    expect(PortfolioSummary.parse(summary)).toBeTruthy();

    const history = await svc.getHistory("a", {
      from: new Date("2026-06-19T00:00:00Z"),
      to: new Date("2026-06-19T23:59:59Z"),
    });
    expect(history.length).toBeGreaterThan(0);
    expect(EquityPoint.parse(history[0])).toBeTruthy();

    // B2: 取引履歴・実現損益の読み取り IF。
    const trades = await svc.getTrades("a");
    expect(trades).toHaveLength(1);
    expect(Trade.parse(trades[0])).toBeTruthy();

    await svc.applyTrade({
      id: "t2",
      orderId: "o2",
      accountId: "a",
      instrumentId: "i-1",
      side: "SELL",
      quantity: 40,
      price: "1500",
      fee: "0",
      currency: "JPY",
      executedAt: "2026-06-19T01:00:00.000Z",
    });
    const realized = await svc.getRealizedPnl("a");
    expect(realized).toHaveLength(1);
    expect(RealizedPnl.parse(realized[0])).toBeTruthy();

    // Phase 3: 譲渡益課税の概算が CapitalGainsTaxEstimate スキーマに通る。
    const tax = await svc.estimateCapitalGainsTax!("a", {
      from: new Date("2026-06-19T00:00:00Z"),
      to: new Date("2026-06-19T23:59:59Z"),
    });
    expect(tax).toHaveLength(1);
    expect(CapitalGainsTaxEstimate.parse(tax[0])).toBeTruthy();
  });

  it("withdraw は残高不足を拒否する（B4）", async () => {
    const svc = build();
    await svc.deposit("w", { amount: "1000", currency: "JPY" });
    await svc.withdraw("w", { amount: "400", currency: "JPY" });
    await expect(
      svc.withdraw("w", { amount: "700", currency: "JPY" }),
    ).rejects.toThrow(/INSUFFICIENT_FUNDS|exceeds/);
  });
});
