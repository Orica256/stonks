import { describe, expect, it } from "vitest";
import {
  CorporateAction,
  Instrument,
  PriceBar,
  Quote,
  FxRate,
} from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import { mockFetch, singleFetch } from "../test-helpers.js";
import { YahooAdapter } from "./yahoo.js";
import { FinnhubAdapter } from "./finnhub.js";
import { JQuantsAdapter } from "./jquants.js";
import { ExchangeRateAdapter } from "./exchangerate.js";

describe("YahooAdapter normalization", () => {
  it("normalizes a JP quote into the Quote contract", async () => {
    const { fn } = singleFetch({
      json: {
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 2500.5, symbol: "7203.T" },
              timestamp: [1_700_000_000],
            },
          ],
        },
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const q = await yahoo.getQuote("TSE:7203");
    expect(Quote.parse(q)).toEqual(q); // 契約スキーマに適合
    expect(q.instrumentId).toBe("TSE:7203");
    expect(q.last).toBe("2500.5");
    expect(q.source).toBe("yahoo");
  });

  it("normalizes US daily bars and skips gap rows", async () => {
    const { fn } = singleFetch({
      json: {
        chart: {
          result: [
            {
              timestamp: [1_700_000_000, 1_700_086_400, 1_700_172_800],
              indicators: {
                quote: [
                  {
                    open: [10, null, 12],
                    high: [11, null, 13],
                    low: [9, null, 11],
                    close: [10.5, null, 12.5],
                    volume: [1000, null, 2000],
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const bars = await yahoo.getBars({
      instrumentId: "NASDAQ:AAPL",
      timeframe: "1d",
      from: "2023-11-01T00:00:00.000Z",
      to: "2023-11-30T00:00:00.000Z",
    });
    expect(bars).toHaveLength(2); // null 行は除外
    for (const b of bars) expect(PriceBar.parse(b)).toEqual(b);
    expect(bars[0]!.close).toBe("10.5");
  });

  it("normalizes search results, filtering by market", async () => {
    const { fn } = singleFetch({
      json: {
        quotes: [
          { symbol: "AAPL", longname: "Apple Inc.", quoteType: "EQUITY" },
          { symbol: "7203.T", longname: "Toyota", quoteType: "EQUITY" },
          { symbol: "NEWS", quoteType: "NEWS" },
        ],
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const us = await yahoo.searchInstruments("a", "US");
    expect(us).toHaveLength(1);
    expect(Instrument.parse(us[0])).toEqual(us[0]);
    expect(us[0]!.id).toBe("NASDAQ:AAPL");
    expect(us[0]!.currency).toBe("USD");
  });

  it("populates margin-eligibility flags by rule (US=true/true, JP=true/undefined)", async () => {
    const { fn } = singleFetch({
      json: {
        quotes: [
          { symbol: "AAPL", longname: "Apple Inc.", quoteType: "EQUITY" },
          { symbol: "7203.T", longname: "Toyota", quoteType: "EQUITY" },
        ],
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const all = await yahoo.searchInstruments("a");
    const aapl = all.find((i) => i.id === "NASDAQ:AAPL")!;
    const toyota = all.find((i) => i.id === "TSE:7203")!;
    expect(aapl.marginTradable).toBe(true);
    expect(aapl.shortMarginable).toBe(true);
    expect(toyota.marginTradable).toBe(true);
    expect(toyota.shortMarginable).toBeUndefined();
  });

  it("applies margin-eligibility overrides on search results", async () => {
    const { fn } = singleFetch({
      json: {
        quotes: [
          { symbol: "7203.T", longname: "Toyota", quoteType: "EQUITY" },
        ],
      },
    });
    const yahoo = new YahooAdapter({
      fetchFn: fn,
      marginEligibility: {
        overrides: { "TSE:7203": { shortMarginable: true } },
      },
    });
    const [toyota] = await yahoo.searchInstruments("toyota", "JP");
    expect(Instrument.parse(toyota)).toEqual(toyota);
    expect(toyota!.marginTradable).toBe(true);
    expect(toyota!.shortMarginable).toBe(true);
  });

  it("normalizes dividend and split corporate actions", async () => {
    const { fn, calls } = singleFetch({
      json: {
        chart: {
          result: [
            {
              events: {
                dividends: {
                  "1700000000": { amount: 0.24, date: 1_700_000_000 },
                },
                splits: {
                  "1690000000": {
                    numerator: 4,
                    denominator: 1,
                    splitRatio: "4:1",
                    date: 1_690_000_000,
                  },
                },
              },
            },
          ],
        },
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const actions = await yahoo.getCorporateActions({
      instrumentId: "NASDAQ:AAPL",
      from: "2023-07-01T00:00:00.000Z",
      to: "2023-12-01T00:00:00.000Z",
    });
    expect(actions).toHaveLength(2);
    for (const a of actions) expect(CorporateAction.parse(a)).toEqual(a);
    // ex-date 昇順（split が dividend より前）。
    const split = actions[0]!;
    const div = actions[1]!;
    expect(split.type).toBe("SPLIT");
    expect(split.value).toBe("4");
    expect(div.type).toBe("DIVIDEND");
    expect(div.value).toBe("0.24");
    expect(calls[0]).toContain("events=div");
  });

  it("returns an empty array when there are no events", async () => {
    const { fn } = singleFetch({ json: { chart: { result: [{}] } } });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const actions = await yahoo.getCorporateActions({
      instrumentId: "NASDAQ:AAPL",
      from: "2023-01-01T00:00:00.000Z",
      to: "2023-12-01T00:00:00.000Z",
    });
    expect(actions).toEqual([]);
  });

  it("derives a reverse split ratio from splitRatio when numerator is absent", async () => {
    const { fn } = singleFetch({
      json: {
        chart: {
          result: [
            {
              events: {
                splits: {
                  "1690000000": { splitRatio: "1:10", date: 1_690_000_000 },
                },
              },
            },
          ],
        },
      },
    });
    const yahoo = new YahooAdapter({ fetchFn: fn });
    const actions = await yahoo.getCorporateActions({
      instrumentId: "NASDAQ:AAPL",
      from: "2023-01-01T00:00:00.000Z",
      to: "2023-12-01T00:00:00.000Z",
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.value).toBe("0.1"); // 1:10 併合
  });
});

describe("FinnhubAdapter", () => {
  it("normalizes a US quote and attaches the token", async () => {
    const { fn, calls } = singleFetch({
      json: { c: 189.95, t: 1_700_000_000 },
    });
    const fh = new FinnhubAdapter({ apiKey: "KEY", fetchFn: fn });
    const q = await fh.getQuote("NASDAQ:AAPL");
    expect(Quote.parse(q)).toEqual(q);
    expect(q.last).toBe("189.95");
    expect(q.source).toBe("finnhub");
    expect(calls[0]).toContain("token=KEY");
    expect(calls[0]).toContain("symbol=AAPL");
  });

  it("only supports US instruments", () => {
    const fh = new FinnhubAdapter({ apiKey: "KEY" });
    expect(fh.supports("NASDAQ:AAPL")).toBe(true);
    expect(fh.supports("TSE:7203")).toBe(false);
  });

  it("fromEnv returns null without an API key", () => {
    expect(FinnhubAdapter.fromEnv({})).toBeNull();
    expect(FinnhubAdapter.fromEnv({ FINNHUB_API_KEY: "k" })).not.toBeNull();
  });

  it("maps HTTP 429 to a RATE_LIMITED DomainError", async () => {
    const { fn } = singleFetch({ status: 429, json: {} });
    const fh = new FinnhubAdapter({ apiKey: "KEY", fetchFn: fn });
    await expect(fh.getQuote("NASDAQ:AAPL")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("JQuantsAdapter", () => {
  it("exchanges refresh token then normalizes daily bars", async () => {
    const { fn, calls } = mockFetch([
      {
        match: (u) => u.includes("token/auth_refresh"),
        respond: { json: { idToken: "ID-TOKEN" } },
      },
      {
        match: (u) => u.includes("prices/daily_quotes"),
        respond: {
          json: {
            daily_quotes: [
              {
                Date: "2024-01-04",
                Code: "7203",
                Open: 2500,
                High: 2550,
                Low: 2490,
                Close: 2530,
                Volume: 12345,
              },
            ],
          },
        },
      },
    ]);
    const jq = new JQuantsAdapter({ refreshToken: "RT", fetchFn: fn });
    const bars = await jq.getBars({
      instrumentId: "TSE:7203",
      timeframe: "1d",
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-31T00:00:00.000Z",
    });
    expect(bars).toHaveLength(1);
    expect(PriceBar.parse(bars[0])).toEqual(bars[0]);
    expect(bars[0]!.close).toBe("2530");
    expect(bars[0]!.ts).toBe("2024-01-04T00:00:00.000Z");
    // auth_refresh が daily_quotes より前に呼ばれている
    expect(calls[0]).toContain("auth_refresh");
    expect(calls[1]).toContain("daily_quotes");
  });

  it("caches the idToken across calls", async () => {
    const { fn, calls } = mockFetch([
      {
        match: (u) => u.includes("token/auth_refresh"),
        respond: { json: { idToken: "ID-TOKEN" } },
      },
      {
        match: (u) => u.includes("prices/daily_quotes"),
        respond: { json: { daily_quotes: [{ Date: "2024-01-04", Close: 1 }] } },
      },
    ]);
    let t = 0;
    const jq = new JQuantsAdapter({
      refreshToken: "RT",
      fetchFn: fn,
      now: () => (t += 1000), // 仮想時計を進めてレート待機を回避
    });
    await jq.getQuote("TSE:7203");
    await jq.getQuote("TSE:7203");
    const authCalls = calls.filter((c) => c.includes("auth_refresh"));
    expect(authCalls).toHaveLength(1); // 2 回目はキャッシュした idToken
  });

  it("rejects intraday timeframes (free tier is EOD only)", async () => {
    const jq = new JQuantsAdapter({ refreshToken: "RT" });
    await expect(
      jq.getBars({
        instrumentId: "TSE:7203",
        timeframe: "5m",
        from: "2024-01-01T00:00:00.000Z",
        to: "2024-01-02T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("only supports JP instruments", () => {
    const jq = new JQuantsAdapter({ refreshToken: "RT" });
    expect(jq.supports("TSE:7203")).toBe(true);
    expect(jq.supports("NASDAQ:AAPL")).toBe(false);
  });

  it("derives SPLIT corporate actions from AdjustmentFactor", async () => {
    const { fn } = mockFetch([
      {
        match: (u) => u.includes("token/auth_refresh"),
        respond: { json: { idToken: "ID-TOKEN" } },
      },
      {
        match: (u) => u.includes("prices/daily_quotes"),
        respond: {
          json: {
            daily_quotes: [
              { Date: "2024-01-04", Close: 2530, AdjustmentFactor: 1 },
              // 2:1 分割の権利落ち（係数 0.5 → 比率 2）。
              { Date: "2024-01-10", Close: 1270, AdjustmentFactor: 0.5 },
              { Date: "2024-01-11", Close: 1280, AdjustmentFactor: 1 },
            ],
          },
        },
      },
    ]);
    const jq = new JQuantsAdapter({ refreshToken: "RT", fetchFn: fn });
    const actions = await jq.getCorporateActions({
      instrumentId: "TSE:7203",
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-31T00:00:00.000Z",
    });
    expect(actions).toHaveLength(1);
    expect(CorporateAction.parse(actions[0])).toEqual(actions[0]);
    expect(actions[0]!.type).toBe("SPLIT");
    expect(actions[0]!.value).toBe("2");
    expect(actions[0]!.exDate).toBe("2024-01-10T00:00:00.000Z");
  });
});

describe("ExchangeRateAdapter (FX)", () => {
  it("normalizes USD/JPY into the FxRate contract", async () => {
    const { fn } = singleFetch({ json: { rates: { JPY: 156.42 }, date: "2024-06-01" } });
    const fx = new ExchangeRateAdapter({ fetchFn: fn });
    const r = await fx.getRate("USD", "JPY");
    expect(FxRate.parse(r)).toEqual(r);
    expect(r.rate).toBe("156.42");
    expect(r.base).toBe("USD");
    expect(r.quote).toBe("JPY");
  });

  it("caches the latest rate (one fetch for repeated calls)", async () => {
    const { fn, calls } = singleFetch({ json: { rates: { JPY: 150 } } });
    const fx = new ExchangeRateAdapter({ fetchFn: fn });
    await fx.getRate("USD", "JPY");
    await fx.getRate("USD", "JPY");
    expect(calls).toHaveLength(1);
  });

  it("rejects unsupported currency pairs", async () => {
    const fx = new ExchangeRateAdapter({ fetchFn: singleFetch({ json: {} }).fn });
    await expect(
      // @ts-expect-error 契約外の通貨ペアは型でも弾く
      fx.getRate("JPY", "USD"),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
