import type { BacktestResult } from "@stonks/contracts";

/**
 * バックテスト結果の表示用変換（spec §2.5）。
 *
 * `BacktestResult.equityCurve` は `{ ts, equity(DecimalString) }[]`。これを
 * lightweight-charts の折れ線データ（UNIX 秒 + 数値）へ整形する。ここは**表示用の
 * 座標変換のみ**で金額演算は行わない（CLAUDE.md §0: 金額に浮動小数を使わない）。
 */

/** エクイティカーブの 1 点（time は lightweight-charts 互換の UNIX 秒）。 */
export interface EquityChartPoint {
  /** 時刻の UNIX 秒（UTC）。 */
  time: number;
  /** 口座評価額（表示用の数値化）。 */
  value: number;
}

/**
 * エクイティカーブを折れ線データへ変換する。
 * - ts・equity が有限値の点のみ採用（壊れた行はスキップ）。
 * - 時刻昇順を保証する（重複/逆順は描画側が嫌うため安定ソート）。
 * - ルックアヘッドはしない（各点は自分の値のみ参照）。
 */
export function toEquityChart(
  curve: BacktestResult["equityCurve"],
): EquityChartPoint[] {
  const out: EquityChartPoint[] = [];
  for (const point of curve) {
    const value = Number(point.equity);
    const time = Math.floor(new Date(point.ts).getTime() / 1000);
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** バックテスト指標を画面表示用に整形した 1 行。 */
export interface MetricView {
  label: string;
  /** 整形済み文字列（"+12.34%" 等）。 */
  display: string;
  /** 符号による色付けに使う元値（比率や損益）。色不要なら null。 */
  tone: number | null;
}

/**
 * `BacktestResult.metrics` を表示用の指標カード配列へ整形する。
 * totalReturn / maxDrawdown / winRate は比率（0.12=12%）、sharpe は素の数値、
 * trades は約定回数。投資判断を促す表現は付けない（CLAUDE.md §7）。
 */
export function toMetricViews(
  metrics: BacktestResult["metrics"],
): MetricView[] {
  return [
    {
      label: "総リターン",
      display: formatRatioPct(metrics.totalReturn),
      tone: Number.isFinite(metrics.totalReturn) ? metrics.totalReturn : null,
    },
    {
      label: "最大ドローダウン",
      // ドローダウンは下落幅。負の値として下げ色で示す。
      display: formatDrawdownPct(metrics.maxDrawdown),
      tone: drawdownTone(metrics.maxDrawdown),
    },
    {
      label: "シャープレシオ",
      display: formatNumber(metrics.sharpe),
      tone: Number.isFinite(metrics.sharpe) ? metrics.sharpe : null,
    },
    {
      label: "勝率",
      display: formatRatioPct(metrics.winRate, false),
      tone: null,
    },
    {
      label: "約定回数",
      display: Number.isFinite(metrics.trades)
        ? String(metrics.trades)
        : "—",
      tone: null,
    },
  ];
}

/** 比率を百分率へ。signed=true なら符号付き（+12.34%）。 */
function formatRatioPct(ratio: number, signed = true): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * 最大ドローダウンの表示。契約上は大きさ（0.2=20% の下落）を想定し、
 * 常に下落として `-` を付す。すでに負値で来た場合も大きさで揃える。
 */
function formatDrawdownPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value) * 100;
  if (magnitude === 0) return "0.00%";
  return `-${magnitude.toFixed(2)}%`;
}

/** ドローダウンの色トーン（0 は中立、それ以外は下げ色）。 */
function drawdownTone(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.abs(value) === 0 ? 0 : -Math.abs(value);
}

/** 素の数値（シャープ等）を小数 2 桁で。 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
