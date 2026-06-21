import { describe, expect, it } from "vitest";
import {
  CostBasisMethod,
  InterestAccrual,
  MarginInfo,
  MarginType,
  Order,
  PlaceOrderCommand,
  Position,
  Rate,
  TaxLot,
  Trade,
} from "./index.js";

describe("MarginType / back-compat (Phase 3)", () => {
  it("Order omits marginType when not provided (現物フロー後方互換)", () => {
    const r = Order.parse({
      id: "o1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "BUY",
      type: "MARKET",
      quantity: 100,
      createdAt: "2026-06-20T00:00:00Z",
      updatedAt: "2026-06-20T00:00:00Z",
    });
    // optional: 未指定は undefined（消費側が CASH と解釈。永続層は Prisma 既定）。
    expect(r.marginType).toBeUndefined();
  });

  it("PlaceOrderCommand keeps marginType optional and accepts MARGIN", () => {
    const cash = PlaceOrderCommand.parse({
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "BUY",
      type: "MARKET",
      quantity: 100,
    });
    expect(cash.marginType).toBeUndefined();

    const margin = PlaceOrderCommand.parse({
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "SELL",
      type: "MARKET",
      quantity: 100,
      marginType: "MARGIN",
    });
    expect(margin.marginType).toBe("MARGIN");
  });

  it("Trade and Position keep marginType optional (現物は未設定)", () => {
    const t = Trade.parse({
      id: "t1",
      orderId: "o1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "BUY",
      quantity: 100,
      price: "2000",
      fee: "0",
      currency: "JPY",
      executedAt: "2026-06-20T00:00:00Z",
    });
    expect(t.marginType).toBeUndefined();

    const p = Position.parse({
      id: "p1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      quantity: 100,
      avgCost: "2000",
      currency: "JPY",
      openedAt: "2026-06-20T00:00:00Z",
    });
    expect(p.marginType).toBeUndefined();
    expect(p.margin).toBeUndefined();
  });

  it("accepts an explicit MARGIN Trade", () => {
    const t = Trade.parse({
      id: "t1",
      orderId: "o1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "SELL",
      quantity: 100,
      price: "2000",
      fee: "0",
      currency: "JPY",
      marginType: "MARGIN",
      executedAt: "2026-06-20T00:00:00Z",
    });
    expect(t.marginType).toBe("MARGIN");
  });

  it("rejects unknown marginType", () => {
    expect(MarginType.safeParse("LEVERAGE").success).toBe(false);
  });
});

describe("Position margin info (信用拡張)", () => {
  it("accepts a MARGIN position with margin info", () => {
    const p = Position.parse({
      id: "p1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      side: "SHORT",
      quantity: 100,
      avgCost: "2000",
      currency: "JPY",
      marginType: "MARGIN",
      margin: {
        postedMargin: "60000",
        initialMarginRate: "0.30",
        maintenanceMarginRate: "0.20",
        annualRate: "0.011",
      },
      openedAt: "2026-06-20T00:00:00Z",
    });
    expect(p.margin?.accruedInterest).toBe("0");
  });
});

describe("Rate / MarginInfo (率は浮動小数禁止)", () => {
  it("accepts non-negative decimal strings, rejects floats and negatives", () => {
    expect(Rate.safeParse("0.03").success).toBe(true);
    expect(Rate.safeParse("0").success).toBe(true);
    expect(Rate.safeParse(0.03).success).toBe(false);
    expect(Rate.safeParse("-0.01").success).toBe(false);
  });

  it("MarginInfo defaults accruedInterest to 0", () => {
    const m = MarginInfo.parse({
      postedMargin: "60000",
      initialMarginRate: "0.30",
      maintenanceMarginRate: "0.20",
      annualRate: "0.011",
    });
    expect(m.accruedInterest).toBe("0");
  });
});

describe("InterestAccrual (金利/貸株料)", () => {
  it("accepts INTEREST and BORROW_FEE", () => {
    const base = {
      id: "ia1",
      accountId: "a1",
      positionId: "p1",
      instrumentId: "TSE:7203",
      principal: "200000",
      annualRate: "0.011",
      days: 1,
      amount: "-6.03",
      currency: "JPY" as const,
      accruedAt: "2026-06-20T00:00:00Z",
    };
    expect(InterestAccrual.safeParse({ ...base, type: "INTEREST" }).success).toBe(
      true,
    );
    expect(
      InterestAccrual.safeParse({ ...base, type: "BORROW_FEE" }).success,
    ).toBe(true);
    expect(InterestAccrual.safeParse({ ...base, type: "FOO" }).success).toBe(
      false,
    );
  });
});

describe("TaxLot (税ロット)", () => {
  it("defaults method=AVERAGE and taxAccountType=SPECIFIC", () => {
    const lot = TaxLot.parse({
      id: "lot1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      quantity: 100,
      remainingQuantity: 100,
      costBasis: "2000",
      currency: "JPY",
      acquiredAt: "2026-06-20T00:00:00Z",
    });
    expect(lot.method).toBe("AVERAGE");
    expect(lot.taxAccountType).toBe("SPECIFIC");
  });

  it("rejects float costBasis (浮動小数禁止)", () => {
    const r = TaxLot.safeParse({
      id: "lot1",
      accountId: "a1",
      instrumentId: "TSE:7203",
      quantity: 100,
      remainingQuantity: 100,
      costBasis: 2000,
      currency: "JPY",
      acquiredAt: "2026-06-20T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("CostBasisMethod enumerates the supported methods", () => {
    expect(CostBasisMethod.options).toContain("FIFO");
    expect(CostBasisMethod.options).toContain("SPECIFIC_LOT");
  });
});
