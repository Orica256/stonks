import type { PriceBar } from "@stonks/contracts";

/**
 * 複数銘柄比較のための純粋関数群（spec §2.4 P2「複数銘柄比較」）。
 *
 * 価格は contracts の PriceBar（DecimalString）で受け取り、**表示用の指数化のみ**を行う。
 * 金額演算ではなく相対リターンの可視化が目的（CLAUDE.md §0: 金額に浮動小数を使わない／
 * 演算は core-domain。ここは表示整形のためのチャート座標計算に閉じる）。
 */

/** 正規化系列の 1 点（time は lightweight-charts 互換の UNIX 秒）。 */
export interface NormalizedPoint {
  /** バー開始時刻の UNIX 秒（UTC）。 */
  time: number;
  /** 基準値（既定 100）に対する指数値。 */
  value: number;
}

/** 1 銘柄ぶんの正規化済みリターン系列。 */
export interface NormalizedSeries {
  instrumentId: string;
  /** 表示ラベル（シンボル等）。呼び出し側が与える。 */
  label: string;
  /** 系列の表示色。 */
  color: string;
  points: NormalizedPoint[];
}

/**
 * バー列を基準値からの指数（既定 100）に正規化する。
 *
 * - 最初の有効な終値（finite かつ > 0）を基準とし、各点を `base * close / firstClose` にする。
 * - 基準が定まらない（空・非正・非有限）場合は空配列を返す（描画なし）。
 * - ルックアヘッドはしない（各点は自分の終値のみ参照）。
 */
export function normalizeBars(bars: PriceBar[], base = 100): NormalizedPoint[] {
  let firstClose: number | undefined;
  const out: NormalizedPoint[] = [];

  for (const bar of bars) {
    const close = Number(bar.close);
    const time = Math.floor(new Date(bar.ts).getTime() / 1000);
    if (!Number.isFinite(close) || !Number.isFinite(time)) continue;

    if (firstClose === undefined) {
      if (close <= 0) continue; // 基準は正の値から
      firstClose = close;
    }

    out.push({ time, value: (base * close) / firstClose });
  }

  return out;
}

/**
 * 系列の最終値から累積リターン（基準比）を求める。
 * 例: base=100 で末尾 112 → 0.12（+12%）。データ不足時は undefined。
 */
export function seriesReturn(
  points: NormalizedPoint[],
  base = 100,
): number | undefined {
  const last = points.at(-1);
  if (!last || base === 0) return undefined;
  return last.value / base - 1;
}
