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
