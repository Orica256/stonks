import Decimal from "decimal.js";
import type { BacktestMetrics } from "@stonks/contracts";

/** エクイティカーブの 1 点（金額は Decimal 文字列）。 */
export interface EquitySample {
  ts: string;
  equity: string;
}

/**
 * エクイティカーブと約定結果から BacktestResult.metrics を算出する。
 *
 * - totalReturn: (最終 equity / 初期 equity) - 1（比率, 例 0.12 = +12%）。
 * - maxDrawdown: ピークからの最大下落率（正の比率, 例 0.2 = 20% DD）。
 * - sharpe:      バーごと単純リターン系列の (平均/標準偏差) を年率化なしで返す。
 * - winRate:     決済トレードのうち利益 > 0 の割合（0..1）。
 * - trades:      決済（クローズ）トレード数。
 *
 * すべて equity 系列（その時点までの値）から導出し未来を参照しない。
 */
export function computeMetrics(args: {
  initialEquity: string;
  curve: EquitySample[];
  closedPnls: Decimal[];
}): BacktestMetrics {
  const { initialEquity, curve, closedPnls } = args;
  const initial = new Decimal(initialEquity);

  const last =
    curve.length > 0 ? new Decimal(curve[curve.length - 1]!.equity) : initial;

  const totalReturn = initial.isZero()
    ? 0
    : last.dividedBy(initial).minus(1).toNumber();

  // 最大ドローダウン（ピーク基準の下落率）。
  let peak = initial;
  let maxDd = new Decimal(0);
  for (const p of curve) {
    const e = new Decimal(p.equity);
    if (e.greaterThan(peak)) peak = e;
    if (peak.greaterThan(0)) {
      const dd = peak.minus(e).dividedBy(peak);
      if (dd.greaterThan(maxDd)) maxDd = dd;
    }
  }

  // バーごとリターン系列（equity の単純変化率）。
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = new Decimal(curve[i - 1]!.equity);
    const cur = new Decimal(curve[i]!.equity);
    if (!prev.isZero()) {
      returns.push(cur.dividedBy(prev).minus(1).toNumber());
    }
  }
  const sharpe = sharpeRatio(returns);

  const wins = closedPnls.filter((p) => p.greaterThan(0)).length;
  const winRate = closedPnls.length === 0 ? 0 : wins / closedPnls.length;

  return {
    totalReturn,
    maxDrawdown: maxDd.toNumber(),
    sharpe,
    winRate,
    trades: closedPnls.length,
  };
}

/** リターン系列のシャープレシオ（無リスク 0・年率化なし）。標準偏差 0 なら 0。 */
function sharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return mean / sd;
}
