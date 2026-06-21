import type { PriceBar } from "@stonks/contracts";

/**
 * ヒートマップ用の純粋関数群（spec §2.4 P2「ヒートマップ」）。
 *
 * 騰落率はバー列の直近 2 本（前バー終値 → 最新バー終値）から算出する。
 * 値は表示用の相対変化であり、金額演算ではない（CLAUDE.md §0）。
 */

/** 騰落率の強度バケット（色分けの段階）。0 は中立。 */
export type HeatLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3;

/** タイル 1 枚ぶんの表示モデル。 */
export interface HeatCell {
  instrumentId: string;
  label: string;
  /** 直近バー比の騰落率（0.012 = +1.2%）。算出不能なら undefined。 */
  changeRatio: number | undefined;
  level: HeatLevel;
}

/**
 * バー列から「前バー終値 → 最新バー終値」の騰落率を求める。
 * バーが 2 本未満、または基準終値が非正/非有限なら undefined。
 */
export function changeFromBars(bars: PriceBar[]): number | undefined {
  if (bars.length < 2) return undefined;
  const prev = Number(bars[bars.length - 2]?.close);
  const last = Number(bars[bars.length - 1]?.close);
  if (!Number.isFinite(prev) || !Number.isFinite(last) || prev <= 0) {
    return undefined;
  }
  return last / prev - 1;
}

/** 騰落率（比率）の絶対値しきい値（昇順）。±0.5% / ±2% / ±5% で段階化。 */
const THRESHOLDS = [0.005, 0.02, 0.05] as const;

/**
 * 騰落率を色強度バケットへ写像する。
 * undefined や 0 近傍は中立(0)。上方向は 1..3、下方向は -1..-3。
 */
export function heatLevel(changeRatio: number | undefined): HeatLevel {
  if (changeRatio === undefined || !Number.isFinite(changeRatio)) return 0;
  const abs = Math.abs(changeRatio);
  let magnitude = 0;
  for (const t of THRESHOLDS) {
    if (abs >= t) magnitude += 1;
  }
  if (magnitude === 0) return 0;
  const signed = changeRatio > 0 ? magnitude : -magnitude;
  return signed as HeatLevel;
}

/** バケットに対応する Tailwind 背景クラス（gain=緑 / loss=赤 / 中立=灰）。 */
const LEVEL_BG: Record<HeatLevel, string> = {
  [-3]: "bg-loss text-white",
  [-2]: "bg-loss/70 text-white",
  [-1]: "bg-loss/30 text-loss",
  0: "bg-neutral-100 text-neutral-500",
  1: "bg-gain/30 text-gain",
  2: "bg-gain/70 text-white",
  3: "bg-gain text-white",
};

/** 強度バケットから Tailwind の背景/文字色クラスを返す。 */
export function heatColorClass(level: HeatLevel): string {
  return LEVEL_BG[level];
}
