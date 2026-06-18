import Decimal from "decimal.js";

/**
 * 外部 API が返す数値（number/string）を contracts の DecimalString
 * （`/^-?\d+(\.\d+)?$/`、指数表記なし）へ正規化する。
 * 浮動小数の汚染を避けるため、文字列があれば文字列を優先する。
 */
export const toDecimalString = (v: number | string): string => {
  const d = new Decimal(v);
  // toFixed() は指数表記を避ける。末尾ゼロは付与しない。
  return d.toFixed();
};

/** UNIX 秒 → ISO8601(UTC, offset 付き)。contracts の Timestamp 形式。 */
export const epochSecToIso = (sec: number): string =>
  new Date(sec * 1000).toISOString();

/** UNIX ミリ秒 → ISO8601(UTC)。 */
export const epochMsToIso = (ms: number): string =>
  new Date(ms).toISOString();
