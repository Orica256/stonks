import { describe, expect, it } from "vitest";
import { timeframeRange } from "./timeframe-range";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-25T12:00:00.000Z");

describe("timeframeRange", () => {
  it("to は now、from は時間足ごとのルックバック日数だけ過去（ISO8601 UTC）", () => {
    const cases: Array<[Parameters<typeof timeframeRange>[0], number]> = [
      ["1m", 2],
      ["5m", 5],
      ["15m", 14],
      ["1h", 60],
      ["1d", 365],
    ];
    for (const [timeframe, days] of cases) {
      const { from, to } = timeframeRange(timeframe, NOW);
      expect(to).toBe(NOW.toISOString());
      expect(from).toBe(
        new Date(NOW.getTime() - days * MS_PER_DAY).toISOString(),
      );
    }
  });

  it("from は常に to より過去", () => {
    for (const tf of ["1m", "5m", "15m", "1h", "1d"] as const) {
      const { from, to } = timeframeRange(tf, NOW);
      expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
    }
  });

  it("1m と 1d で窓幅が異なる（分足は狭く・日足は広い）", () => {
    const minute = timeframeRange("1m", NOW);
    const day = timeframeRange("1d", NOW);
    const minuteSpan =
      new Date(minute.to).getTime() - new Date(minute.from).getTime();
    const daySpan = new Date(day.to).getTime() - new Date(day.from).getTime();
    expect(minuteSpan).toBeLessThan(daySpan);
    expect(minuteSpan).toBe(2 * MS_PER_DAY);
    expect(daySpan).toBe(365 * MS_PER_DAY);
  });
});
