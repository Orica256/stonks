import type { Currency, Money } from "@stonks/contracts";

/**
 * 表示用フォーマッタ。金額は contracts の DecimalString（浮動小数を使わない）で
 * 受け取り、Intl で**表示のみ**整形する。演算はここで行わない（CLAUDE.md §0）。
 */

const FRACTION_DIGITS: Record<Currency, number> = {
  JPY: 0,
  USD: 2,
};

/** 通貨記号付きで金額（DecimalString）を整形する。値が壊れていれば素のまま返す。 */
export function formatMoney(amount: string, currency: Currency): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: FRACTION_DIGITS[currency],
    maximumFractionDigits: FRACTION_DIGITS[currency],
  }).format(n);
}

/** Money 値オブジェクトを整形する。 */
export function formatMoneyValue(money: Money): string {
  return formatMoney(money.amount, money.currency);
}

/** 価格（DecimalString）を桁区切りで整形（通貨記号なし）。 */
export function formatPrice(value: string, currency: Currency): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    minimumFractionDigits: FRACTION_DIGITS[currency],
    maximumFractionDigits: currency === "JPY" ? 2 : 4,
  }).format(n);
}

/** 数量（株数）を桁区切りで整形する。 */
export function formatQuantity(qty: number): string {
  return new Intl.NumberFormat("en-US").format(qty);
}

/** 比率（0.1234 → "+12.34%"）を符号付きで整形する。 */
export function formatPercent(ratio: number, digits = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/** 符号付きの数値整形（損益額の表示など）。 */
export function formatSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

/** UTC タイムスタンプを市場ローカルではなくユーザロケールの日時で表示する。 */
export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

/** 損益の符号から表示色クラスを返す（gain/loss/中立）。 */
export function pnlColorClass(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "text-neutral-500";
  return value > 0 ? "text-gain" : "text-loss";
}

/** 未知のエラー値を UI 表示用メッセージに正規化する。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "読み込みに失敗しました。";
}
