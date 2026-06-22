import { describe, expect, it } from "vitest";
import type {
  FxProvider,
  MarketDataProvider,
  PriceProvider,
} from "@stonks/contracts";
import { createMarketDataProvider } from "./factory.js";
import { MarketDataRegistry } from "./registry.js";
import { singleFetch } from "./test-helpers.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）。公開ファサードが contracts の
 * MarketDataProvider / PriceProvider / FxProvider の 3 形状に適合することを保証する。
 */
describe("market-data contract conformance", () => {
  it("MarketDataRegistry satisfies all three interfaces (compile + shape)", () => {
    const reg = new MarketDataRegistry({ adapters: [] });
    // 代入が通ること自体が型レベルの契約遵守。
    const mdp: MarketDataProvider = reg;
    const pp: PriceProvider = reg;
    const fx: FxProvider = reg;
    expect(typeof mdp.searchInstruments).toBe("function");
    expect(typeof mdp.getQuote).toBe("function");
    expect(typeof mdp.getBars).toBe("function");
    // optional な getCorporateActions も registry は提供する（B12, spec §6.1）。
    expect(typeof mdp.getCorporateActions).toBe("function");
    expect(typeof pp.getLatestPrice).toBe("function");
    expect(typeof fx.getRate).toBe("function");
  });

  it("factory yields a working provider with only Yahoo + FX (no keys set)", async () => {
    const provider = createMarketDataProvider({
      env: {}, // キー無し → Finnhub/J-Quants はスキップ、Yahoo のみ
      fetchFn: singleFetch({
        json: {
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 100, symbol: "AAPL" },
                timestamp: [1_700_000_000],
              },
            ],
          },
        },
      }).fn,
      quoteCacheTtlMs: 0,
    });
    const mdp: MarketDataProvider = provider;
    const q = await mdp.getQuote("NASDAQ:AAPL");
    expect(q.source).toBe("yahoo");
    expect(q.last).toBe("100");
  });
});
