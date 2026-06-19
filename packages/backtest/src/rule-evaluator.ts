import { sma } from "@stonks/analytics";

/**
 * 戦略ルールの `when` 式を評価する最小評価器（spec §2.5）。
 *
 * サポートする式（大文字小文字無視）:
 * - `SMA(n) crossUp SMA(m)`   … 短期 SMA が長期を上抜け（i-1 で <=, i で >）
 * - `SMA(n) crossDown SMA(m)` … 短期 SMA が長期を下抜け
 * - `price > N` / `price < N` / `price >= N` / `price <= N`
 * - `always`                  … 常に true（buy&hold 等のテスト用）
 *
 * すべて index i 時点（その時点までの close 列）のみで評価し、未来を参照しない。
 */
export type WhenEvaluator = (closes: number[], i: number) => boolean;

const SMA_CROSS =
  /^sma\(\s*(\d+)\s*\)\s+(crossup|crossdown)\s+sma\(\s*(\d+)\s*\)$/;
const PRICE_CMP = /^price\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/;

export function compileWhen(when: string): WhenEvaluator {
  const expr = when.trim().toLowerCase();

  if (expr === "always") {
    return () => true;
  }

  const cross = SMA_CROSS.exec(expr);
  if (cross) {
    const fast = Number(cross[1]);
    const dir = cross[2];
    const slow = Number(cross[3]);
    return (closes, i) => {
      if (i < 1) return false;
      const window = closes.slice(0, i + 1);
      const f = sma(window, fast);
      const s = sma(window, slow);
      const fPrev = f[i - 1];
      const sPrev = s[i - 1];
      const fNow = f[i];
      const sNow = s[i];
      if (fPrev == null || sPrev == null || fNow == null || sNow == null) {
        return false;
      }
      return dir === "crossup"
        ? fPrev <= sPrev && fNow > sNow
        : fPrev >= sPrev && fNow < sNow;
    };
  }

  const cmp = PRICE_CMP.exec(expr);
  if (cmp) {
    const op = cmp[1]!;
    const threshold = Number(cmp[2]);
    return (closes, i) => {
      const p = closes[i];
      if (p == null) return false;
      switch (op) {
        case ">":
          return p > threshold;
        case "<":
          return p < threshold;
        case ">=":
          return p >= threshold;
        case "<=":
          return p <= threshold;
        default:
          return false;
      }
    };
  }

  throw new Error(`unsupported strategy expression: "${when}"`);
}
