import type { Currency, MarginPolicy } from "@stonks/contracts";

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
  /**
   * 信用取引（MARGIN）の既定保証金/金利ポリシー（spec §2.2 P2）。
   * trading-engine の MarginPolicyProvider へ供給する規定値。env で差し替え可。
   * 率はすべて非負小数文字列（`Rate`。例 "0.30" = 30%）。
   */
  marginPolicy: MarginPolicy;
  /**
   * 信用取引を許可しない銘柄 id の集合（`EXCHANGE:SYMBOL`）。
   * ここに含まれる銘柄は MarginPolicyProvider が null を返し、MARGIN 発注は拒否される。
   * 既定は空（全銘柄一律ポリシー）。env `MARGIN_DISALLOWED_INSTRUMENTS`（カンマ区切り）で指定。
   */
  marginDisallowedInstruments: ReadonlySet<string>;
}

const parseCurrency = (raw: string | undefined): Currency =>
  raw === "USD" ? "USD" : "JPY";

const parseIntOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** 非負小数文字列（Rate）を env から読む。空/不正・負値は fallback を使う。 */
const parseRateOr = (raw: string | undefined, fallback: string): string => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim();
  // Rate は非負小数文字列。負値・非数値は採用しない（誤設定で発注が壊れないように）。
  if (v.startsWith("-") || !Number.isFinite(Number(v))) return fallback;
  return v;
};

/** カンマ区切りの instrumentId 集合を env から読む。空なら空集合。 */
const parseIdSet = (raw: string | undefined): ReadonlySet<string> => {
  if (raw === undefined || raw.trim() === "") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
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
  // 信用の既定ポリシー（日本信用の概算。投資情報の断定ではなくシミュレーション既定値）。
  marginPolicy: {
    initialMarginRate: parseRateOr(env.MARGIN_INITIAL_RATE, "0.30"),
    maintenanceMarginRate: parseRateOr(env.MARGIN_MAINTENANCE_RATE, "0.20"),
    annualInterestRate: parseRateOr(env.MARGIN_ANNUAL_INTEREST_RATE, "0.028"),
    annualBorrowRate: parseRateOr(env.MARGIN_ANNUAL_BORROW_RATE, "0.011"),
  },
  marginDisallowedInstruments: parseIdSet(env.MARGIN_DISALLOWED_INSTRUMENTS),
});
