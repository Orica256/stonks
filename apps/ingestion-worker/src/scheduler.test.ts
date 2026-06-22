import { describe, expect, it } from "vitest";
import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { buildBackfillJobs, buildSchedule } from "./scheduler.js";
import { JOB } from "./jobs.js";

const baseCfg = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  ...loadWorkerConfig({ INGEST_UNIVERSE: "TSE:7203,NASDAQ:AAPL" }),
  ...over,
});

describe("buildSchedule", () => {
  it("ユニバース各銘柄の poll-quote・分足取込・1 件の FX を登録する", () => {
    const specs = buildSchedule(baseCfg());
    const polls = specs.filter((s) => s.name === JOB.PollQuote);
    const intraday = specs.filter((s) => s.name === JOB.IngestIntradayBars);
    const fx = specs.filter((s) => s.name === JOB.FetchFxRate);
    expect(polls).toHaveLength(2);
    // 既定の分足足種は 1m のみ → 銘柄ごとに 1 件
    expect(intraday).toHaveLength(2);
    expect(fx).toHaveLength(1);
    expect(polls.map((s) => s.jobId)).toEqual([
      "poll-quote:TSE:7203",
      "poll-quote:NASDAQ:AAPL",
    ]);
    expect(intraday.map((s) => s.jobId)).toEqual([
      "ingest-intraday-bars:TSE:7203:1m",
      "ingest-intraday-bars:NASDAQ:AAPL:1m",
    ]);
    expect(fx[0]?.jobId).toBe("fetch-fx-rate:USD-JPY");
  });

  it("複数足種を設定すると銘柄 × 足種で分足取込を登録する", () => {
    const specs = buildSchedule(
      baseCfg({ intradayTimeframes: ["1m", "5m", "1h"] }),
    );
    const intraday = specs.filter((s) => s.name === JOB.IngestIntradayBars);
    // 2 銘柄 × 3 足種
    expect(intraday).toHaveLength(6);
    expect(intraday[0]?.cron).toBe(baseCfg().intradayBarsCron);
    const sample = intraday.find(
      (s) => s.jobId === "ingest-intraday-bars:TSE:7203:5m",
    );
    expect(sample?.data).toMatchObject({ timeframe: "5m", lookbackMinutes: 120 });
  });

  it("分足足種が空なら分足取込を登録しない", () => {
    const specs = buildSchedule(baseCfg({ intradayTimeframes: [] }));
    expect(specs.filter((s) => s.name === JOB.IngestIntradayBars)).toHaveLength(
      0,
    );
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
