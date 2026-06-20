import { describe, expect, it } from "vitest";
import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { buildBackfillJobs, buildSchedule } from "./scheduler.js";
import { JOB } from "./jobs.js";

const baseCfg = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  ...loadWorkerConfig({ INGEST_UNIVERSE: "TSE:7203,NASDAQ:AAPL" }),
  ...over,
});

describe("buildSchedule", () => {
  it("ユニバース各銘柄の poll-quote と 1 件の FX を登録する", () => {
    const specs = buildSchedule(baseCfg());
    const polls = specs.filter((s) => s.name === JOB.PollQuote);
    const fx = specs.filter((s) => s.name === JOB.FetchFxRate);
    expect(polls).toHaveLength(2);
    expect(fx).toHaveLength(1);
    expect(polls.map((s) => s.jobId)).toEqual([
      "poll-quote:TSE:7203",
      "poll-quote:NASDAQ:AAPL",
    ]);
    expect(fx[0]?.jobId).toBe("fetch-fx-rate:USD-JPY");
  });

  it("ユニバースが空なら FX のみ", () => {
    const specs = buildSchedule(baseCfg({ universe: [] }));
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe(JOB.FetchFxRate);
  });

  it("cron は config の値を使う", () => {
    const specs = buildSchedule(baseCfg({ pollQuoteCron: "*/1 * * * *" }));
    const poll = specs.find((s) => s.name === JOB.PollQuote);
    expect(poll?.cron).toBe("*/1 * * * *");
  });
});

describe("buildBackfillJobs", () => {
  it("各銘柄に [now-backfillDays, now] の日足ジョブを作る", () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const jobs = buildBackfillJobs(baseCfg({ backfillDays: 10 }), now);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.name).toBe(JOB.BackfillBars);
    expect(jobs[0]?.data.to).toBe("2026-06-20T00:00:00.000Z");
    expect(jobs[0]?.data.from).toBe("2026-06-10T00:00:00.000Z");
    expect(jobs[0]?.data.timeframe).toBe("1d");
  });
});
