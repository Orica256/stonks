import { describe, expect, it } from "vitest";
import {
  errorMessage,
  formatMoney,
  formatPercent,
  formatRatePercent,
  formatSigned,
  pnlColorClass,
} from "./format";

describe("formatPercent", () => {
  it("符号付きで百分率に整形する", () => {
    expect(formatPercent(0.1234)).toBe("+12.34%");
    expect(formatPercent(-0.05)).toBe("-5.00%");
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("非有限値はダッシュにする", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatRatePercent", () => {
  it("率（DecimalString）を符号なしのパーセント表記にする", () => {
    expect(formatRatePercent("0.20315")).toBe("20.315%");
    expect(formatRatePercent("0")).toBe("0%");
    expect(formatRatePercent("0.05")).toBe("5%");
  });

  it("壊れた値はダッシュにする", () => {
    expect(formatRatePercent("abc")).toBe("—");
  });
});

describe("formatMoney（譲渡益課税の概算表示で使用）", () => {
  it("通貨別に DecimalString を整形する", () => {
    // 通貨記号は環境の ICU 実装に依存するため桁区切り部分のみ検証する。
    expect(formatMoney("24378", "JPY")).toContain("24,378");
    expect(formatMoney("12.5", "USD")).toBe("$12.50");
  });

  it("壊れた値は素のまま返す", () => {
    expect(formatMoney("abc", "JPY")).toBe("abc JPY");
  });
});

describe("formatSigned", () => {
  it("正値に + を付ける", () => {
    expect(formatSigned(1.5)).toBe("+1.50");
    expect(formatSigned(-1.5)).toBe("-1.50");
  });
});

describe("pnlColorClass", () => {
  it("符号で色クラスを返す", () => {
    expect(pnlColorClass(10)).toBe("text-gain");
    expect(pnlColorClass(-10)).toBe("text-loss");
    expect(pnlColorClass(0)).toBe("text-neutral-500");
  });
});

describe("errorMessage", () => {
  it("Error はメッセージを、未知値は既定文言を返す", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("x")).toBe("読み込みに失敗しました。");
  });
});
