import { describe, expect, it } from "vitest";
import { DomainError } from "@stonks/contracts";
import { dispatch } from "./dispatch.js";
import { JOB } from "./jobs.js";
import { FakeMarketData, FakeRepository } from "./test-fakes.js";

const deps = () => ({
  market: new FakeMarketData(),
  repo: new FakeRepository(),
  now: () => new Date("2026-06-19T14:00:00Z"),
});

describe("dispatch", () => {
  it("backfill-bars をハンドラへ振り分ける", async () => {
    const d = deps();
    const res = (await dispatch(d, {
      name: JOB.BackfillBars,
      data: {
        instrumentId: "TSE:7203",
        timeframe: "1d",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-06-01T00:00:00.000Z",
      },
    })) as { written: number };
    expect(res.written).toBe(0);
  });

  it("ingest-intraday-bars をハンドラへ振り分け、デフォルトを補完する", async () => {
    const d = deps();
    const res = (await dispatch(d, {
      name: JOB.IngestIntradayBars,
      data: { instrumentId: "NASDAQ:AAPL" },
    })) as { written: number; skipped: boolean };
    // 2026-06-19 14:00Z は NY 場中 → スキップせず getBars（フェイクは空配列）
    expect(res.skipped).toBe(false);
    expect(res.written).toBe(0);
    expect(d.market.barsCalls[0]?.timeframe).toBe("1m"); // 既定 1m
  });

  it("poll-quote のデフォルト値（force/market）を Zod で補完する", async () => {
    const d = deps();
    const res = (await dispatch(d, {
      name: JOB.PollQuote,
      data: { instrumentId: "NASDAQ:AAPL" },
    })) as { skipped: boolean };
    expect(res.skipped).toBe(false);
    expect(d.repo.quotes).toHaveLength(1);
  });

  it("fetch-fx-rate のデフォルト USD/JPY を補完する", async () => {
    const d = deps();
    await dispatch(d, { name: JOB.FetchFxRate, data: {} });
    expect(d.repo.fxRates).toHaveLength(1);
  });

  it("不正ペイロードは Zod が弾く", async () => {
    const d = deps();
    await expect(
      dispatch(d, {
        name: JOB.BackfillBars,
        data: { instrumentId: "not-an-id", from: "x", to: "y" },
      }),
    ).rejects.toThrow();
  });

  it("未知ジョブ名は VALIDATION エラー", async () => {
    const d = deps();
    await expect(
      dispatch(d, { name: "nope", data: {} }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
