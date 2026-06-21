import { describe, expect, it } from "vitest";
import type { PriceBar } from "@stonks/contracts";
import { changeFromBars, heatColorClass, heatLevel } from "./heatmap";

function bar(close: string): PriceBar {
  return {
    instrumentId: "TSE:7203",
    timeframe: "1d",
    ts: "2026-01-01T00:00:00.000Z",
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  };
}

describe("changeFromBars", () => {
  it("前バー終値→最新バー終値の騰落率を返す", () => {
    expect(changeFromBars([bar("100"), bar("110")])).toBeCloseTo(0.1, 10);
    expect(changeFromBars([bar("200"), bar("180")])).toBeCloseTo(-0.1, 10);
  });

  it("バーが2本未満なら undefined", () => {
    expect(changeFromBars([bar("100")])).toBeUndefined();
    expect(changeFromBars([])).toBeUndefined();
  });

  it("基準終値が非正/非有限なら undefined", () => {
    expect(changeFromBars([bar("0"), bar("100")])).toBeUndefined();
    expect(changeFromBars([bar("abc"), bar("100")])).toBeUndefined();
  });
});

describe("heatLevel", () => {
  it("しきい値(±0.5%/±2%/±5%)で段階化する", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(0.001)).toBe(0);
    expect(heatLevel(0.005)).toBe(1);
    expect(heatLevel(0.02)).toBe(2);
    expect(heatLevel(0.05)).toBe(3);
    expect(heatLevel(0.5)).toBe(3);
  });

  it("下落は負方向の同じ強度になる", () => {
    expect(heatLevel(-0.005)).toBe(-1);
    expect(heatLevel(-0.02)).toBe(-2);
    expect(heatLevel(-0.05)).toBe(-3);
  });

  it("undefined / 非有限は中立(0)", () => {
    expect(heatLevel(undefined)).toBe(0);
    expect(heatLevel(Number.NaN)).toBe(0);
  });
});

describe("heatColorClass", () => {
  it("各バケットにクラスを割り当てる", () => {
    expect(heatColorClass(0)).toContain("neutral");
    expect(heatColorClass(3)).toContain("gain");
    expect(heatColorClass(-3)).toContain("loss");
  });
});
