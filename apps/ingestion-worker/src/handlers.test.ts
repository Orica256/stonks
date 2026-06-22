import { describe, expect, it } from "vitest";
import { DomainError } from "@stonks/contracts";
import {
  handleBackfillBars,
  handleFetchFxRate,
  handleIngestIntradayBars,
  handlePollQuote,
  type HandlerDeps,
} from "./handlers.js";
import { FakeMarketData, FakeRepository } from "./test-fakes.js";

const mkDeps = (market: FakeMarketData, repo: FakeRepository): HandlerDeps => ({
  market,
  repo,
});

describe("handleBackfillBars", () => {
  it("getBars の結果を repo へ保存し件数を返す", async () => {
    const bars = [
      {
        instrumentId: "NASDAQ:AAPL",
        timeframe: "1d" as const,
        ts: "2026-06-19T00:00:00.000Z",
        open: "100",
        high: "110",
        low: "99",
        close: "105",
        volume: 1000,
      },
    ];
    const market = new FakeMarketData({ bars });
    const repo = new FakeRepository();
    const res = await handleBackfillBars(mkDeps(market, repo), {
      instrumentId: "NASDAQ:AAPL",
      timeframe: "1d",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-20T00:00:00.000Z",
    });
    expect(res.written).toBe(1);
    expect(repo.bars).toHaveLength(1);
    expect(market.barsCalls[0]?.instrumentId).toBe("NASDAQ:AAPL");
  });

  it("プロバイダ失敗は伝播する（market-data 側でフォールバック済みの最終失敗）", async () => {
    const market = new FakeMarketData({ throwOn: "bars" });
    const repo = new FakeRepository();
    await expect(
      handleBackfillBars(mkDeps(market, repo), {
        instrumentId: "NASDAQ:AAPL",
        timeframe: "1d",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-20T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(repo.bars).toHaveLength(0);
  });
});

describe("handleIngestIntradayBars", () => {
  const bar = (ts: string) => ({
    instrumentId: "NASDAQ:AAPL",
    timeframe: "1m" as const,
    ts,
    open: "100",
    high: "101",
    low: "99",
    close: "100.5",
    volume: 10,
  });

  it("場中はローリングウィンドウで getBars し保存する", async () => {
    const market = new FakeMarketData({ bars: [bar("2026-06-19T13:59:00.000Z")] });
    const repo = new FakeRepository();
    // 2026-06-19(金) 14:00 UTC = NY 場中
    const res = await handleIngestIntradayBars(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-19T14:00:00Z") },
      { instrumentId: "NASDAQ:AAPL", timeframe: "1m", lookbackMinutes: 120, force: false },
    );
    expect(res.skipped).toBe(false);
    expect(res.written).toBe(1);
    expect(repo.bars).toHaveLength(1);
    const call = market.barsCalls[0]!;
    expect(call.timeframe).toBe("1m");
    expect(call.to).toBe("2026-06-19T14:00:00.000Z");
    expect(call.from).toBe("2026-06-19T12:00:00.000Z"); // 120 分前
  });

  it("休場中は force=false でスキップしプロバイダを呼ばない", async () => {
    const market = new FakeMarketData();
    const repo = new FakeRepository();
    const res = await handleIngestIntradayBars(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-20T14:00:00Z") }, // 土曜
      { instrumentId: "NASDAQ:AAPL", timeframe: "1m", lookbackMinutes: 60, force: false },
    );
    expect(res.skipped).toBe(true);
    expect(res.written).toBe(0);
    expect(market.barsCalls).toHaveLength(0);
    expect(repo.bars).toHaveLength(0);
  });

  it("force=true なら休場でも取得する", async () => {
    const market = new FakeMarketData({ bars: [bar("2026-06-20T13:59:00.000Z")] });
    const repo = new FakeRepository();
    const res = await handleIngestIntradayBars(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-20T14:00:00Z") },
      { instrumentId: "NASDAQ:AAPL", timeframe: "5m", lookbackMinutes: 60, force: true },
    );
    expect(res.skipped).toBe(false);
    expect(market.barsCalls[0]?.timeframe).toBe("5m");
  });
});

describe("handlePollQuote", () => {
  it("市場が開いていれば quote を取得・保存する", async () => {
    const market = new FakeMarketData();
    const repo = new FakeRepository();
    // 2026-06-19(金) 14:00 UTC = NY 10:00（場中）
    const res = await handlePollQuote(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-19T14:00:00Z") },
      { instrumentId: "NASDAQ:AAPL", force: false },
    );
    expect(res.skipped).toBe(false);
    expect(repo.quotes).toHaveLength(1);
    expect(market.quoteCalls).toEqual(["NASDAQ:AAPL"]);
  });

  it("休場中は force=false でスキップしプロバイダを呼ばない", async () => {
    const market = new FakeMarketData();
    const repo = new FakeRepository();
    // 土曜 = 休場
    const res = await handlePollQuote(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-20T14:00:00Z") },
      { instrumentId: "NASDAQ:AAPL", force: false },
    );
    expect(res.skipped).toBe(true);
    expect(market.quoteCalls).toHaveLength(0);
    expect(repo.quotes).toHaveLength(0);
  });

  it("force=true なら休場でも取得する", async () => {
    const market = new FakeMarketData();
    const repo = new FakeRepository();
    const res = await handlePollQuote(
      { ...mkDeps(market, repo), now: () => new Date("2026-06-20T14:00:00Z") },
      { instrumentId: "NASDAQ:AAPL", force: true },
    );
    expect(res.skipped).toBe(false);
    expect(repo.quotes).toHaveLength(1);
  });
});

describe("handleFetchFxRate", () => {
  it("USD/JPY を取得し保存する", async () => {
    const market = new FakeMarketData();
    const repo = new FakeRepository();
    const res = await handleFetchFxRate(mkDeps(market, repo), {
      base: "USD",
      quote: "JPY",
    });
    expect(res.rate).toBe("150.0");
    expect(repo.fxRates).toHaveLength(1);
    expect(market.rateCalls).toBe(1);
  });
});
