import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@stonks/contracts";
import type { Quote } from "@stonks/contracts";
import { MarketDataRegistry } from "./registry.js";
import type { FxAdapter, ProviderAdapter } from "./types.js";

const quote = (instrumentId: string, source: string): Quote => ({
  instrumentId,
  last: "100",
  ts: "2024-01-01T00:00:00.000Z",
  source,
});

describe("MarketDataRegistry fallback chain", () => {
  it("falls back to the next adapter when the first throws", async () => {
    const failing: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi
        .fn()
        .mockRejectedValue(new DomainError("PROVIDER_UNAVAILABLE", "down")),
    };
    const working: ProviderAdapter = {
      name: "b",
      supports: () => true,
      getQuote: vi.fn().mockResolvedValue(quote("NASDAQ:AAPL", "b")),
    };
    const reg = new MarketDataRegistry({
      adapters: [failing, working],
      quoteCacheTtlMs: 0,
    });
    const q = await reg.getQuote("NASDAQ:AAPL");
    expect(q.source).toBe("b");
    expect(failing.getQuote).toHaveBeenCalledOnce();
    expect(working.getQuote).toHaveBeenCalledOnce();
  });

  it("skips adapters whose supports() is false", async () => {
    const jpOnly: ProviderAdapter = {
      name: "jp",
      supports: (id) => id.startsWith("TSE:"),
      getQuote: vi.fn().mockResolvedValue(quote("x", "jp")),
    };
    const usOnly: ProviderAdapter = {
      name: "us",
      supports: (id) => id.startsWith("NASDAQ:"),
      getQuote: vi.fn().mockResolvedValue(quote("NASDAQ:AAPL", "us")),
    };
    const reg = new MarketDataRegistry({
      adapters: [jpOnly, usOnly],
      quoteCacheTtlMs: 0,
    });
    const q = await reg.getQuote("NASDAQ:AAPL");
    expect(q.source).toBe("us");
    expect(jpOnly.getQuote).not.toHaveBeenCalled();
  });

  it("throws the last error when all adapters fail", async () => {
    const a: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi.fn().mockRejectedValue(new DomainError("RATE_LIMITED", "x")),
    };
    const b: ProviderAdapter = {
      name: "b",
      supports: () => true,
      getQuote: vi
        .fn()
        .mockRejectedValue(new DomainError("PROVIDER_UNAVAILABLE", "y")),
    };
    const reg = new MarketDataRegistry({ adapters: [a, b], quoteCacheTtlMs: 0 });
    await expect(reg.getQuote("NASDAQ:AAPL")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("throws PROVIDER_UNAVAILABLE when no adapter supports the operation", async () => {
    const noBars: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi.fn(),
    };
    const reg = new MarketDataRegistry({ adapters: [noBars] });
    await expect(
      reg.getBars({
        instrumentId: "NASDAQ:AAPL",
        timeframe: "1d",
        from: "2024-01-01T00:00:00.000Z",
        to: "2024-01-02T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("caches quotes within TTL (single adapter call)", async () => {
    let t = 0;
    const adapter: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi.fn().mockResolvedValue(quote("NASDAQ:AAPL", "a")),
    };
    const reg = new MarketDataRegistry({
      adapters: [adapter],
      quoteCacheTtlMs: 1000,
      now: () => t,
    });
    await reg.getQuote("NASDAQ:AAPL");
    await reg.getQuote("NASDAQ:AAPL");
    expect(adapter.getQuote).toHaveBeenCalledOnce();
    t = 2000;
    await reg.getQuote("NASDAQ:AAPL");
    expect(adapter.getQuote).toHaveBeenCalledTimes(2);
  });

  it("getLatestPrice returns Money in the instrument currency", async () => {
    const adapter: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi.fn().mockResolvedValue(quote("TSE:7203", "a")),
    };
    const reg = new MarketDataRegistry({ adapters: [adapter] });
    const price = await reg.getLatestPrice("TSE:7203");
    expect(price).toEqual({ amount: "100", currency: "JPY" });
  });

  it("getLatestPrice(at) uses the last daily bar close", async () => {
    const adapter: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getBars: vi.fn().mockResolvedValue([
        {
          instrumentId: "NASDAQ:AAPL",
          timeframe: "1d",
          ts: "2024-01-05T00:00:00.000Z",
          open: "1",
          high: "2",
          low: "1",
          close: "1.5",
          volume: 10,
        },
      ]),
    };
    const reg = new MarketDataRegistry({ adapters: [adapter] });
    const price = await reg.getLatestPrice(
      "NASDAQ:AAPL",
      new Date("2024-01-06T00:00:00.000Z"),
    );
    expect(price).toEqual({ amount: "1.5", currency: "USD" });
  });

  it("getCorporateActions falls back and filters by exDate window", async () => {
    const failing: ProviderAdapter = {
      name: "jq",
      supports: () => true,
      getCorporateActions: vi
        .fn()
        .mockRejectedValue(new DomainError("PROVIDER_UNAVAILABLE", "down")),
    };
    const working: ProviderAdapter = {
      name: "yahoo",
      supports: () => true,
      getCorporateActions: vi.fn().mockResolvedValue([
        // 期間内
        {
          instrumentId: "NASDAQ:AAPL",
          type: "DIVIDEND",
          exDate: "2024-02-09T00:00:00.000Z",
          value: "0.24",
        },
        // 期間外（to より後）→ レジストリが落とす
        {
          instrumentId: "NASDAQ:AAPL",
          type: "DIVIDEND",
          exDate: "2024-05-09T00:00:00.000Z",
          value: "0.25",
        },
      ]),
    };
    const reg = new MarketDataRegistry({ adapters: [failing, working] });
    const actions = await reg.getCorporateActions({
      instrumentId: "NASDAQ:AAPL",
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-03-01T00:00:00.000Z",
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.exDate).toBe("2024-02-09T00:00:00.000Z");
    expect(failing.getCorporateActions).toHaveBeenCalledOnce();
    expect(working.getCorporateActions).toHaveBeenCalledOnce();
  });

  it("getCorporateActions throws PROVIDER_UNAVAILABLE when no adapter implements it", async () => {
    const noCa: ProviderAdapter = {
      name: "a",
      supports: () => true,
      getQuote: vi.fn(),
    };
    const reg = new MarketDataRegistry({ adapters: [noCa] });
    await expect(
      reg.getCorporateActions({
        instrumentId: "NASDAQ:AAPL",
        from: "2024-01-01T00:00:00.000Z",
        to: "2024-03-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("delegates FX to the configured fx adapter", async () => {
    const fx: FxAdapter = {
      name: "fx",
      getRate: vi.fn().mockResolvedValue({
        base: "USD",
        quote: "JPY",
        rate: "150",
        ts: "2024-01-01T00:00:00.000Z",
      }),
    };
    const reg = new MarketDataRegistry({ adapters: [], fxAdapter: fx });
    const r = await reg.getRate("USD", "JPY");
    expect(r.rate).toBe("150");
  });

  it("throws when FX is requested without an fx adapter", async () => {
    const reg = new MarketDataRegistry({ adapters: [] });
    await expect(reg.getRate("USD", "JPY")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});
