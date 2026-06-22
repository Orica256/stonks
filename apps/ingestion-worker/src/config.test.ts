import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";

describe("loadWorkerConfig", () => {
  it("空 env で安全な既定値を返す", () => {
    const cfg = loadWorkerConfig({});
    expect(cfg.redisUrl).toBe("redis://localhost:6379");
    expect(cfg.concurrency).toBe(2);
    expect(cfg.scheduleEnabled).toBe(true);
    expect(cfg.universe).toEqual([]);
    expect(cfg.backfillTimeframe).toBe("1d");
    expect(cfg.backfillDays).toBe(365);
    expect(cfg.intradayBarsCron).toBe("*/5 * * * *");
    expect(cfg.intradayTimeframes).toEqual(["1m"]);
    expect(cfg.intradayLookbackMinutes).toBe(120);
  });

  it("分足設定を解釈し未知の足種は無視する", () => {
    const cfg = loadWorkerConfig({
      INGEST_INTRADAY_TIMEFRAMES: "1m, 1h, 1d, bogus, 5m",
      INGEST_INTRADAY_LOOKBACK_MIN: "30",
      INGEST_INTRADAY_BARS_CRON: "*/1 * * * *",
    });
    // 1d / bogus は IntradayTimeframe ではないため除外される
    expect(cfg.intradayTimeframes).toEqual(["1m", "1h", "5m"]);
    expect(cfg.intradayLookbackMinutes).toBe(30);
    expect(cfg.intradayBarsCron).toBe("*/1 * * * *");
  });

  it("env を解釈する（universe はカンマ区切り・空白除去）", () => {
    const cfg = loadWorkerConfig({
      REDIS_URL: "redis://h:6380",
      INGEST_CONCURRENCY: "4",
      INGEST_SCHEDULE_ENABLED: "false",
      INGEST_UNIVERSE: " TSE:7203 , NASDAQ:AAPL ",
      INGEST_BACKFILL_DAYS: "30",
    });
    expect(cfg.redisUrl).toBe("redis://h:6380");
    expect(cfg.concurrency).toBe(4);
    expect(cfg.scheduleEnabled).toBe(false);
    expect(cfg.universe).toEqual(["TSE:7203", "NASDAQ:AAPL"]);
    expect(cfg.backfillDays).toBe(30);
  });

  it("不正な数値は既定値へフォールバック", () => {
    const cfg = loadWorkerConfig({ INGEST_CONCURRENCY: "abc" });
    expect(cfg.concurrency).toBe(2);
  });
});
