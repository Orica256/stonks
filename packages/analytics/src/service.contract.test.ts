import {
  IndicatorResult,
  type IndicatorService,
  type PriceBar,
} from "@stonks/contracts";
import { describe, expect, it } from "vitest";
import { indicatorService } from "./service.js";

// 契約 IF 適合の型レベル固定: indicatorService が spec §6.4 の IndicatorService
// として代入可能であること（公開 IF の形が契約と一致することを型で保証する）。
const _conformsToContract: IndicatorService = indicatorService;
void _conformsToContract;

/** テスト用 PriceBar 列を生成（close は Decimal 文字列、ts は UTC ISO8601）。 */
function makeBars(closes: number[]): PriceBar[] {
  const base = Date.UTC(2024, 0, 1);
  const day = 86_400_000;
  return closes.map((c, i) => ({
    instrumentId: "inst-1",
    timeframe: "1d",
    ts: new Date(base + i * day).toISOString(),
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
    volume: 100 + i,
  }));
}

describe("indicatorService.compute — contract conformance", () => {
  const bars = makeBars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("ts length equals input bars and every series matches that length", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [
        { kind: "SMA", params: { period: 3 } },
        { kind: "EMA", params: { period: 3 } },
        { kind: "RSI", params: { period: 4 } },
        { kind: "MACD", params: { fast: 2, slow: 4, signal: 2 } },
        { kind: "BBANDS", params: { period: 3, stdDev: 2 } },
        { kind: "VOLUME", params: {} },
      ],
    });

    expect(res.ts).toHaveLength(bars.length);
    expect(res.ts).toEqual(bars.map((b) => b.ts));
    for (const s of res.series) {
      expect(s.values).toHaveLength(bars.length);
    }
  });

  it("output satisfies the contracts IndicatorResult schema", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [{ kind: "SMA", params: { period: 3 } }],
    });
    expect(() => IndicatorResult.parse(res)).not.toThrow();
  });

  it("SMA series carries the expected null warmup prefix and values", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [{ kind: "SMA", params: { period: 3 } }],
    });
    const s = res.series[0]!;
    expect(s.name).toBe("SMA(3)");
    expect(s.values.slice(0, 2)).toEqual([null, null]);
    expect(s.values[2]).toBe(2);
    expect(s.values.at(-1)).toBe(9);
  });

  it("MACD expands into three named series (macd/signal/histogram)", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [{ kind: "MACD", params: { fast: 2, slow: 4, signal: 2 } }],
    });
    expect(res.series.map((s) => s.name)).toEqual([
      "MACD(2,4,2).macd",
      "MACD(2,4,2).signal",
      "MACD(2,4,2).histogram",
    ]);
  });

  it("BBANDS expands into upper/middle/lower", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [{ kind: "BBANDS", params: { period: 3, stdDev: 2 } }],
    });
    expect(res.series.map((s) => s.name)).toEqual([
      "BBANDS(3,2).upper",
      "BBANDS(3,2).middle",
      "BBANDS(3,2).lower",
    ]);
  });

  it("VOLUME passes through raw bar volumes (no null prefix)", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [{ kind: "VOLUME", params: {} }],
    });
    const s = res.series[0]!;
    expect(s.name).toBe("VOLUME");
    expect(s.values).toEqual(bars.map((b) => b.volume));
  });

  it("uses default periods when params omitted", () => {
    const longBars = makeBars(Array.from({ length: 30 }, (_, i) => i + 1));
    const res = indicatorService.compute({
      bars: longBars,
      indicators: [{ kind: "SMA", params: {} }],
    });
    expect(res.series[0]!.name).toBe("SMA(20)");
  });

  it("handles empty bars without throwing", () => {
    const res = indicatorService.compute({
      bars: [],
      indicators: [{ kind: "SMA", params: { period: 3 } }],
    });
    expect(res.ts).toEqual([]);
    expect(res.series[0]!.values).toEqual([]);
  });

  it("computing multiple specs preserves order and accumulates series", () => {
    const res = indicatorService.compute({
      bars,
      indicators: [
        { kind: "SMA", params: { period: 3 } },
        { kind: "VOLUME", params: {} },
      ],
    });
    expect(res.series.map((s) => s.name)).toEqual(["SMA(3)", "VOLUME"]);
  });
});
