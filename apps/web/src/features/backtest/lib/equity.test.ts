import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@stonks/contracts";
import { toEquityChart, toMetricViews } from "./equity";

describe("toEquityChart", () => {
  it("ts を UNIX 秒(UTC)へ・equity を数値化する", () => {
    const points = toEquityChart([
      { ts: "2026-01-01T00:00:00.000Z", equity: "1000000" },
      { ts: "2026-01-02T00:00:00.000Z", equity: "1010000" },
    ]);
    expect(points).toEqual([
      { time: Date.UTC(2026, 0, 1) / 1000, value: 1_000_000 },
      { time: Date.UTC(2026, 0, 2) / 1000, value: 1_010_000 },
    ]);
  });

  it("非有限な equity/ts の行はスキップする", () => {
    const points = toEquityChart([
      { ts: "2026-01-01T00:00:00.000Z", equity: "abc" },
      { ts: "not-a-date", equity: "1000" },
      { ts: "2026-01-03T00:00:00.000Z", equity: "1200" },
    ]);
    expect(points).toEqual([
      { time: Date.UTC(2026, 0, 3) / 1000, value: 1_200 },
    ]);
  });

  it("時刻昇順へ並べ替える", () => {
    const points = toEquityChart([
      { ts: "2026-01-03T00:00:00.000Z", equity: "3" },
      { ts: "2026-01-01T00:00:00.000Z", equity: "1" },
      { ts: "2026-01-02T00:00:00.000Z", equity: "2" },
    ]);
    expect(points.map((p) => p.value)).toEqual([1, 2, 3]);
  });

  it("空配列は空のまま", () => {
    expect(toEquityChart([])).toEqual([]);
  });
});

describe("toMetricViews", () => {
  const metrics: BacktestResult["metrics"] = {
    totalReturn: 0.1234,
    maxDrawdown: 0.2,
    sharpe: 1.5,
    winRate: 0.6,
    trades: 12,
  };

  it("総リターンを符号付き百分率で整形する", () => {
    const views = toMetricViews(metrics);
    const total = views.find((v) => v.label === "総リターン");
    expect(total?.display).toBe("+12.34%");
    expect(total?.tone).toBe(0.1234);
  });

  it("最大ドローダウンは常に下落表記（負トーン）", () => {
    const views = toMetricViews(metrics);
    const dd = views.find((v) => v.label === "最大ドローダウン");
    expect(dd?.display).toBe("-20.00%");
    expect(dd?.tone).toBeLessThan(0);
  });

  it("勝率は符号なし百分率・色トーンなし", () => {
    const views = toMetricViews(metrics);
    const win = views.find((v) => v.label === "勝率");
    expect(win?.display).toBe("60.00%");
    expect(win?.tone).toBeNull();
  });

  it("シャープと約定回数を整形する", () => {
    const views = toMetricViews(metrics);
    expect(views.find((v) => v.label === "シャープレシオ")?.display).toBe(
      "1.50",
    );
    expect(views.find((v) => v.label === "約定回数")?.display).toBe("12");
  });

  it("非有限値は em ダッシュにフォールバックする", () => {
    const views = toMetricViews({
      totalReturn: Number.NaN,
      maxDrawdown: Number.NaN,
      sharpe: Number.NaN,
      winRate: Number.NaN,
      trades: 0,
    });
    expect(views.find((v) => v.label === "総リターン")?.display).toBe("—");
    expect(views.find((v) => v.label === "シャープレシオ")?.display).toBe("—");
  });
});
