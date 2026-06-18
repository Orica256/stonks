import { describe, expect, it } from "vitest";
import {
  EquityPoint,
  PortfolioSummary,
  PositionView,
  type PortfolioService,
} from "@stonks/contracts";
import { DefaultPortfolioService } from "./portfolio-service.js";
import { InMemoryPortfolioRepository } from "./in-memory-repository.js";
import { FakeFxProvider, FakePriceProvider } from "./fakes.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）。
 * 公開実装が contracts の PortfolioService に一致し、出力が各スキーマに通ることを保証する。
 */
const build = (): PortfolioService & {
  deposit: DefaultPortfolioService["deposit"];
} => {
  const svc = new DefaultPortfolioService({
    repository: new InMemoryPortfolioRepository(),
    priceProvider: new FakePriceProvider({
      "i-1": { amount: "1200", currency: "JPY" },
    }),
    fxProvider: new FakeFxProvider("150"),
    baseCurrency: "JPY",
  });
  return svc;
};

describe("PortfolioService 契約遵守", () => {
  it("DefaultPortfolioService は PortfolioService を実装する", () => {
    const svc: PortfolioService = build();
    expect(typeof svc.applyTrade).toBe("function");
    expect(typeof svc.getPositions).toBe("function");
    expect(typeof svc.getSummary).toBe("function");
    expect(typeof svc.getHistory).toBe("function");
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
  });
});
