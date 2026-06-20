/**
 * 比較チャート/凡例で使う系列色のパレット（表示専用）。
 * 銘柄の追加順に巡回して割り当てる。
 */
export const SERIES_PALETTE = [
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
] as const;

/** インデックスに対応する系列色を返す（パレットを巡回）。 */
export function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length] as string;
}
