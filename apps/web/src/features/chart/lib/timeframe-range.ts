import type { Timeframe } from "@stonks/contracts";

/**
 * 時間足ごとのルックバック窓（from/to）算出（frontend-dev 原則）。
 *
 * API（GET /instruments/:id/bars）は from/to 省略時に時間足に関係なく一律
 * 「直近365日」へフォールバックするため、分足で1年分を要求してしまい実用にならない。
 * そこで時間足ごとに妥当な期間だけを要求するルックバック窓を web 側で算出する。
 */

/**
 * 時間足→ルックバック日数のマップ。
 * 表示密度（バー本数）と取得コストの折り合いで決めた目安値。
 * - 1m  …約2日（分足は直近数日だけ見れば十分）
 * - 5m  …約5日
 * - 15m …約14日（2週間）
 * - 1h  …約60日（2か月）
 * - 1d  …約365日（1年・日足の標準窓）
 */
const LOOKBACK_DAYS: Record<Timeframe, number> = {
  "1m": 2,
  "5m": 5,
  "15m": 14,
  "1h": 60,
  "1d": 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 時間足に応じた取得期間 `{ from, to }`（ともに ISO8601 UTC）を返す純関数。
 * `to` は基準時刻 `now`、`from` は `now − ルックバック日数`。
 * `now` を引数化することでテストで固定でき、呼び出し側はキャッシュキー安定化のため
 * 丸めた時刻を渡せる。
 */
export function timeframeRange(
  timeframe: Timeframe,
  now: Date,
): { from: string; to: string } {
  const toMs = now.getTime();
  const fromMs = toMs - LOOKBACK_DAYS[timeframe] * MS_PER_DAY;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}
