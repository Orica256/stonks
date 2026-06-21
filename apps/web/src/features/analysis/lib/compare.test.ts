import { describe, expect, it } from "vitest";
import type { PriceBar } from "@stonks/contracts";
import { normalizeBars, seriesReturn } from "./compare";

/** テスト用のバー生成（必要フィールドのみ。表示用整形のみを検証）。 */
function bar(ts: string, close: string): PriceBar {
  return {
    instrumentId: "TSE:7203",
    timeframe: "1d",
    ts,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  };
}

describe("normalizeBars", () => {
  it("最初の終値を基準値(既定100)に揃える", () => {
    const points = normalizeBars([
      bar("2026-01-01T00:00:00.000Z", "200"),
      bar("2026-01-02T00:00:00.000Z", "220"),
      bar("2026-01-03T00:00:00.000Z", "180"),
    ]);
    expect(points.map((p) => p.value)).toEqual([100, 110, 90]);
  });

  it("基準値は引数で変更できる", () => {
    const points = normalizeBars(
      [
        bar("2026-01-01T00:00:00.000Z", "50"),
        bar("2026-01-02T00:00:00.000Z", "75"),
      ],
      1,
    );
    expect(points.map((p) => p.value)).toEqual([1, 1.5]);
  });

  it("ts を UNIX 秒(UTC)へ変換する", () => {
    const [p] = normalizeBars([bar("2026-01-01T00:00:00.000Z", "100")]);
    expect(p?.time).toBe(Date.UTC(2026, 0, 1) / 1000);
  });

  it("非有限・非正の終値を基準にしない", () => {
    const points = normalizeBars([
      bar("2026-01-01T00:00:00.000Z", "0"),
      bar("2026-01-02T00:00:00.000Z", "abc"),
      bar("2026-01-03T00:00:00.000Z", "120"),
      bar("2026-01-04T00:00:00.000Z", "150"),
    ]);
    // 最初の有効な正の終値(120)が基準=100 になる。
    expect(points.map((p) => p.value)).toEqual([100, 125]);
  });

  it("空配列は空のまま", () => {
    expect(normalizeBars([])).toEqual([]);
  });
});

describe("seriesReturn", () => {
  it("末尾値から基準比の累積リターンを返す", () => {
    const points = normalizeBars([
      bar("2026-01-01T00:00:00.000Z", "100"),
      bar("2026-01-02T00:00:00.000Z", "112"),
    ]);
    expect(seriesReturn(points)).toBeCloseTo(0.12, 10);
  });

  it("データ不足は undefined", () => {
    expect(seriesReturn([])).toBeUndefined();
  });
});
