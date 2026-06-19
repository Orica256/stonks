import type {
  IndicatorResult,
  IndicatorSeries,
  IndicatorService,
  IndicatorSpec,
  PriceBar,
} from "@stonks/contracts";
import { bbands, ema, macd, rsi, sma } from "./indicators.js";

/** spec.params の整数パラメータを既定値付きで取り出す。 */
function intParam(
  spec: IndicatorSpec,
  key: string,
  fallback: number,
): number {
  const raw = spec.params[key];
  if (raw == null) {
    return fallback;
  }
  if (!Number.isInteger(raw) || raw < 1) {
    throw new Error(
      `${spec.kind}: param "${key}" must be a positive integer (got ${raw})`,
    );
  }
  return raw;
}

/** spec.params の数値パラメータを既定値付きで取り出す（非整数許容）。 */
function numParam(spec: IndicatorSpec, key: string, fallback: number): number {
  const raw = spec.params[key];
  if (raw == null) {
    return fallback;
  }
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `${spec.kind}: param "${key}" must be a positive number (got ${raw})`,
    );
  }
  return raw;
}

/** Decimal 文字列の終値列を数値配列に変換（指標計算の入力）。 */
function toCloses(bars: PriceBar[]): number[] {
  return bars.map((b) => parseDecimal(b.close, "close"));
}

function parseDecimal(value: string, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid decimal in PriceBar.${field}: "${value}"`);
  }
  return n;
}

/** 1 つの IndicatorSpec を 1 本以上の IndicatorSeries に展開する。 */
function computeSpec(spec: IndicatorSpec, bars: PriceBar[]): IndicatorSeries[] {
  switch (spec.kind) {
    case "SMA": {
      const period = intParam(spec, "period", 20);
      return [{ name: `SMA(${period})`, values: sma(toCloses(bars), period) }];
    }
    case "EMA": {
      const period = intParam(spec, "period", 20);
      return [{ name: `EMA(${period})`, values: ema(toCloses(bars), period) }];
    }
    case "RSI": {
      const period = intParam(spec, "period", 14);
      return [{ name: `RSI(${period})`, values: rsi(toCloses(bars), period) }];
    }
    case "MACD": {
      const fast = intParam(spec, "fast", 12);
      const slow = intParam(spec, "slow", 26);
      const signal = intParam(spec, "signal", 9);
      const r = macd(toCloses(bars), fast, slow, signal);
      const tag = `MACD(${fast},${slow},${signal})`;
      return [
        { name: `${tag}.macd`, values: r.macd },
        { name: `${tag}.signal`, values: r.signal },
        { name: `${tag}.histogram`, values: r.histogram },
      ];
    }
    case "BBANDS": {
      const period = intParam(spec, "period", 20);
      const stdDev = numParam(spec, "stdDev", 2);
      const r = bbands(toCloses(bars), period, stdDev);
      const tag = `BBANDS(${period},${stdDev})`;
      return [
        { name: `${tag}.upper`, values: r.upper },
        { name: `${tag}.middle`, values: r.middle },
        { name: `${tag}.lower`, values: r.lower },
      ];
    }
    case "VOLUME": {
      // 出来高はそのまま系列として返す（チャートのオーバーレイ用）。
      return [{ name: "VOLUME", values: bars.map((b) => b.volume) }];
    }
    default: {
      // contracts の IndicatorKind を網羅。未知種別はコンパイル時に検出される。
      const _exhaustive: never = spec.kind;
      throw new Error(`unsupported indicator kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * テクニカル指標サービス（spec §6.4 の `IndicatorService` 実装）。
 *
 * 純粋関数: 副作用なし・DB/ネットワーク非依存。
 * 出力 `ts` は入力バーの ts 列で、各 `series.values` と同じ長さ。
 * バーは呼び出し側で時系列昇順に整列済みであることを前提とする。
 */
export const indicatorService: IndicatorService = {
  compute(req: {
    bars: PriceBar[];
    indicators: IndicatorSpec[];
  }): IndicatorResult {
    const { bars, indicators } = req;
    const ts = bars.map((b) => b.ts);
    const series: IndicatorSeries[] = [];
    for (const spec of indicators) {
      series.push(...computeSpec(spec, bars));
    }
    return { ts, series };
  },
};

/** クラス参照を好む呼び出し側向けの薄いラッパ。 */
export function createIndicatorService(): IndicatorService {
  return indicatorService;
}
