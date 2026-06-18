/**
 * テクニカル指標の純粋計算関数群。
 *
 * すべて副作用なし・DB/ネットワーク非依存（CLAUDE.md §0, spec §6.4）。
 * 入力は数値配列（close 等）、出力は入力と同じ長さの `(number | null)[]`。
 * 計算に必要なウォームアップ期間が満たせない先頭区間は `null`。
 *
 * 注: 価格は contracts では Decimal 文字列で保持される（金額に float を使わない）。
 * 指標値は表示・チャート用の派生値であり、`IndicatorSeries.values` の契約に従い
 * 数値（number）で返す。元の価格列の解釈・パースは呼び出し側（service）が担う。
 */

/**
 * 単純移動平均（SMA）。
 * `values[i]` は直近 `period` 本の平均。`i < period - 1` は `null`。
 */
export function sma(input: number[], period: number): (number | null)[] {
  assertPeriod(period);
  const out: (number | null)[] = new Array(input.length).fill(null);
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i]!;
    if (i >= period) {
      sum -= input[i - period]!;
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

/**
 * 指数移動平均（EMA）。係数 `k = 2 / (period + 1)`。
 * シードは先頭 `period` 本の SMA。`i < period - 1` は `null`。
 */
export function ema(input: number[], period: number): (number | null)[] {
  assertPeriod(period);
  const out: (number | null)[] = new Array(input.length).fill(null);
  if (input.length < period) {
    return out;
  }
  const k = 2 / (period + 1);
  // 先頭 period 本の SMA をシードに採用。
  let seed = 0;
  for (let i = 0; i < period; i++) {
    seed += input[i]!;
  }
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < input.length; i++) {
    prev = input[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * 相対力指数（RSI, Wilder 法）。
 * 先頭 `period` 本で平均利得/損失をシードし、以降は Wilder の平滑化。
 * `i < period` は `null`（最初の値は index `period`）。
 */
export function rsi(input: number[], period: number): (number | null)[] {
  assertPeriod(period);
  const out: (number | null)[] = new Array(input.length).fill(null);
  if (input.length <= period) {
    return out;
  }
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = input[i]! - input[i - 1]!;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum -= change;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < input.length; i++) {
    const change = input[i]! - input[i - 1]!;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/**
 * MACD。`macd = EMA(fast) - EMA(slow)`、`signal = EMA(macd, signalPeriod)`、
 * `histogram = macd - signal`。EMA が未確定の区間は `null`。
 * シグナル EMA は macd が確定している区間のみを対象に計算する。
 */
export function macd(
  input: number[],
  fast: number,
  slow: number,
  signalPeriod: number,
): MacdResult {
  assertPeriod(fast);
  assertPeriod(slow);
  assertPeriod(signalPeriod);
  if (fast >= slow) {
    throw new Error(`MACD requires fast < slow (got fast=${fast}, slow=${slow})`);
  }
  const emaFast = ema(input, fast);
  const emaSlow = ema(input, slow);
  const macdLine: (number | null)[] = input.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f != null && s != null ? f - s : null;
  });

  // signal は macd 確定区間（先頭 null を除く）に対する EMA。
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal: (number | null)[] = new Array(input.length).fill(null);
  if (firstIdx !== -1) {
    const compact = macdLine.slice(firstIdx) as number[];
    const sigCompact = ema(compact, signalPeriod);
    for (let j = 0; j < sigCompact.length; j++) {
      signal[firstIdx + j] = sigCompact[j]!;
    }
  }

  const histogram: (number | null)[] = input.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m != null && s != null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}

export interface BBandsResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

/**
 * ボリンジャーバンド。中央線は SMA(period)、上下バンドは
 * `中央線 ± stdDev * σ`。σ は母標準偏差（period で割る）。
 * `i < period - 1` は `null`。
 */
export function bbands(
  input: number[],
  period: number,
  stdDev: number,
): BBandsResult {
  assertPeriod(period);
  const middle = sma(input, period);
  const upper: (number | null)[] = new Array(input.length).fill(null);
  const lower: (number | null)[] = new Array(input.length).fill(null);
  for (let i = period - 1; i < input.length; i++) {
    const mean = middle[i];
    if (mean == null) {
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = input[j]! - mean;
      variance += d * d;
    }
    variance /= period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }
  return { middle, upper, lower };
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`period must be a positive integer (got ${period})`);
  }
}
