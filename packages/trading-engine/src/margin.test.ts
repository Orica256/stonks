import { describe, expect, it } from "vitest";
import { InterestAccrual, MarginRequirement } from "@stonks/contracts";
import {
  accrualTypeForSide,
  annualRateForSide,
  computeInterestAccrual,
  computeMarginRequirement,
  daysBetween,
  hasSufficientMargin,
  marginPositionSide,
} from "./margin.js";
import { JP_MARGIN_POLICY } from "./test-helpers.js";

describe("computeMarginRequirement", () => {
  it("computes notional and requiredMargin = notional * initialMarginRate", () => {
    const req = computeMarginRequirement({
      quantity: 100,
      price: "1000",
      policy: JP_MARGIN_POLICY,
      currency: "JPY",
    });
    expect(req.notional).toBe("100000");
    expect(req.requiredMargin).toBe("30000"); // 100000 * 0.30
    expect(req.initialMarginRate).toBe("0.30");
    expect(req.currency).toBe("JPY");
    expect(MarginRequirement.safeParse(req).success).toBe(true);
  });
});

describe("marginPositionSide / annualRateForSide / accrualTypeForSide", () => {
  it("maps BUY->LONG and SELL->SHORT", () => {
    expect(marginPositionSide("BUY")).toBe("LONG");
    expect(marginPositionSide("SELL")).toBe("SHORT");
  });

  it("LONG uses interest rate, SHORT uses borrow rate when present", () => {
    expect(annualRateForSide("LONG", JP_MARGIN_POLICY)).toBe("0.028");
    expect(annualRateForSide("SHORT", JP_MARGIN_POLICY)).toBe("0.011");
  });

  it("SHORT falls back to interest rate when borrow rate absent", () => {
    expect(
      annualRateForSide("SHORT", {
        initialMarginRate: "0.3",
        maintenanceMarginRate: "0.2",
        annualInterestRate: "0.028",
      }),
    ).toBe("0.028");
  });

  it("maps accrual type by side", () => {
    expect(accrualTypeForSide("LONG")).toBe("INTEREST");
    expect(accrualTypeForSide("SHORT")).toBe("BORROW_FEE");
  });
});

describe("daysBetween", () => {
  it("returns whole UTC day count and clamps non-positive to 0", () => {
    const a = new Date("2026-06-19T00:00:00Z");
    const b = new Date("2026-06-22T00:00:00Z");
    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(0);
    expect(daysBetween(a, a)).toBe(0);
  });
});

describe("computeInterestAccrual", () => {
  it("computes principal * rate * days / 365 as a negative expense (LONG interest)", () => {
    const accrual = computeInterestAccrual({
      id: "ia-1",
      accountId: "acc-1",
      positionId: "pos-1",
      instrumentId: "jp-7203",
      side: "LONG",
      principal: "1000000",
      annualRate: "0.0365", // 3.65% -> 0.01%/day for round numbers
      days: 10,
      currency: "JPY",
      accruedAt: new Date("2026-06-29T00:00:00Z"),
    });
    // 1,000,000 * 0.0365 * 10 / 365 = 1000 -> expense -1000
    expect(accrual.amount).toBe("-1000");
    expect(accrual.type).toBe("INTEREST");
    expect(accrual.days).toBe(10);
    expect(accrual.principal).toBe("1000000");
    expect(InterestAccrual.safeParse(accrual).success).toBe(true);
  });

  it("rounds up to the currency minimal unit (JPY integer)", () => {
    const accrual = computeInterestAccrual({
      id: "ia-2",
      accountId: "acc-1",
      positionId: "pos-1",
      instrumentId: "jp-7203",
      side: "SHORT",
      principal: "100000",
      annualRate: "0.011",
      days: 1,
      currency: "JPY",
      accruedAt: new Date("2026-06-20T00:00:00Z"),
    });
    // 100000 * 0.011 * 1 / 365 = 3.0136... -> ceil 4 -> -4 (borrow fee)
    expect(accrual.amount).toBe("-4");
    expect(accrual.type).toBe("BORROW_FEE");
  });

  it("zero days yields zero accrual", () => {
    const accrual = computeInterestAccrual({
      id: "ia-3",
      accountId: "acc-1",
      positionId: "pos-1",
      instrumentId: "jp-7203",
      side: "LONG",
      principal: "1000000",
      annualRate: "0.028",
      days: 0,
      currency: "JPY",
      accruedAt: new Date("2026-06-20T00:00:00Z"),
    });
    expect(accrual.amount).toBe("0");
  });
});

describe("hasSufficientMargin", () => {
  it("true when required <= available, false otherwise", () => {
    expect(hasSufficientMargin("30000", "30000", "JPY")).toBe(true);
    expect(hasSufficientMargin("30000", "50000", "JPY")).toBe(true);
    expect(hasSufficientMargin("30001", "30000", "JPY")).toBe(false);
  });
});
