import type { Currency } from "@stonks/contracts";

/**
 * env から導出するアプリ設定。秘密情報（API キー）はここで保持せず
 * createMarketDataProvider に env を直接渡すことで露出を最小化する。
 */
export interface AppConfig {
  port: number;
  baseCurrency: Currency;
  /** DATABASE_URL が設定されていれば Prisma バックのリポジトリを使う。 */
  useDatabase: boolean;
  /** オープン注文の定期評価間隔（ms）。0 で無効。 */
  orderEvalIntervalMs: number;
  /**
   * 成績のベンチマーク比較に使う銘柄 id。未設定のベンチは compare で利用不可。
   * - buyAndHold: BUY_AND_HOLD の買い持ち銘柄
   * - topix / sp500: 指数ベンチに対応する instrumentId
   */
  benchmarkInstruments: {
    buyAndHold?: string;
    topix?: string;
    sp500?: string;
  };
}

const parseCurrency = (raw: string | undefined): Currency =>
  raw === "USD" ? "USD" : "JPY";

const parseIntOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** プロセス環境（または注入された env）から設定を構築する。 */
export const loadConfig = (
  env: Record<string, string | undefined> = process.env,
): AppConfig => ({
  port: parseIntOr(env.PORT, 3001),
  baseCurrency: parseCurrency(env.BASE_CURRENCY),
  useDatabase:
    env.DATABASE_URL !== undefined && env.DATABASE_URL.trim() !== "",
  orderEvalIntervalMs: parseIntOr(env.ORDER_EVAL_INTERVAL_MS, 0),
  benchmarkInstruments: {
    ...(env.AGENT_BENCHMARK_BUY_AND_HOLD?.trim()
      ? { buyAndHold: env.AGENT_BENCHMARK_BUY_AND_HOLD.trim() }
      : {}),
    ...(env.AGENT_BENCHMARK_TOPIX?.trim()
      ? { topix: env.AGENT_BENCHMARK_TOPIX.trim() }
      : {}),
    ...(env.AGENT_BENCHMARK_SP500?.trim()
      ? { sp500: env.AGENT_BENCHMARK_SP500.trim() }
      : {}),
  },
});
