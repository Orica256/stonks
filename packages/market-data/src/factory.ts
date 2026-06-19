import type { AdapterDeps } from "./types.js";
import { MarketDataRegistry } from "./registry.js";
import { FinnhubAdapter } from "./adapters/finnhub.js";
import { YahooAdapter } from "./adapters/yahoo.js";
import { JQuantsAdapter } from "./adapters/jquants.js";
import { ExchangeRateAdapter } from "./adapters/exchangerate.js";

export interface FactoryOptions extends AdapterDeps {
  env?: Record<string, string | undefined>;
  quoteCacheTtlMs?: number;
}

/**
 * 環境変数から実運用構成のレジストリを組み立てる。
 *
 * フォールバック優先順（spec §3.1 の役割分担）:
 *   1. Finnhub  — US 準リアルタイム気配（FINNHUB_API_KEY が必要・未設定ならスキップ）
 *   2. J-Quants — JP 権威データ・EOD（JQUANTS_REFRESH_TOKEN が必要・未設定ならスキップ）
 *   3. Yahoo    — 日米カバレッジ・キー不要・最終フォールバック
 * FX は exchangerate.host（キー不要、FX_API_BASE で上書き可）。
 *
 * 未設定アダプタはスキップされ、Yahoo だけでも最低限機能する。
 */
export const createMarketDataProvider = (
  opts: FactoryOptions = {},
): MarketDataRegistry => {
  const env = opts.env ?? process.env;
  const deps: AdapterDeps = {
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };

  const finnhub = FinnhubAdapter.fromEnv(env, deps);
  const jquants = JQuantsAdapter.fromEnv(env, deps);
  const yahoo = new YahooAdapter(deps);

  const adapters = [finnhub, jquants, yahoo].filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );

  return new MarketDataRegistry({
    adapters,
    fxAdapter: ExchangeRateAdapter.fromEnv(env, deps),
    ...(opts.quoteCacheTtlMs !== undefined
      ? { quoteCacheTtlMs: opts.quoteCacheTtlMs }
      : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
};
