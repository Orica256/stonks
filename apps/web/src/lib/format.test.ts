import { describe, expect, it } from "vitest";
import {
  errorMessage,
  formatPercent,
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
