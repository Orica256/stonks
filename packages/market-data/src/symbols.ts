import type { Currency, Exchange, Market } from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";

/**
 * 銘柄コードの正規化（spec §2.1, §6.1）。
 *
 * contracts の `Instrument.id` はプロバイダ非依存の不透明 ID だが、
 * market-data 層では `EXCHANGE:SYMBOL`（例 `TSE:7203` / `NASDAQ:AAPL`）を
 * 正準形式として採用する。各アダプタはここからプロバイダ固有コード
 * （Yahoo の `7203.T`、Finnhub の `AAPL` 等）へ変換する。
 */
export interface ParsedInstrumentId {
  exchange: Exchange;
  symbol: string;
  market: Market;
  currency: Currency;
}

const EXCHANGE_MARKET: Record<Exchange, Market> = {
  TSE: "JP",
  NYSE: "US",
  NASDAQ: "US",
};

const MARKET_CURRENCY: Record<Market, Currency> = {
  JP: "JPY",
  US: "USD",
};

/** Yahoo Finance のサフィックス（東証は `.T`、米国はサフィックスなし）。 */
const YAHOO_SUFFIX: Record<Exchange, string> = {
  TSE: ".T",
  NYSE: "",
  NASDAQ: "",
};

export const buildInstrumentId = (exchange: Exchange, symbol: string): string =>
  `${exchange}:${symbol.toUpperCase()}`;

/** `EXCHANGE:SYMBOL` をパースする。未知形式は VALIDATION エラー。 */
export const parseInstrumentId = (instrumentId: string): ParsedInstrumentId => {
  const [exchange, symbol] = instrumentId.split(":");
  if (!exchange || !symbol || !(exchange in EXCHANGE_MARKET)) {
    throw new DomainError(
      "VALIDATION",
      `invalid instrumentId: "${instrumentId}" (expected EXCHANGE:SYMBOL)`,
    );
  }
  const ex = exchange as Exchange;
  const market = EXCHANGE_MARKET[ex];
  return {
    exchange: ex,
    symbol: symbol.toUpperCase(),
    market,
    currency: MARKET_CURRENCY[market],
  };
};

/** Yahoo Finance 形式のティッカー（例 `7203.T` / `AAPL`）。 */
export const toYahooSymbol = (parsed: ParsedInstrumentId): string =>
  `${parsed.symbol}${YAHOO_SUFFIX[parsed.exchange]}`;

/** Yahoo の `7203.T` 等から instrumentId を復元する（検索結果の正規化用）。 */
export const fromYahooSymbol = (
  yahooSymbol: string,
  fallbackExchange: Exchange,
): string => {
  if (yahooSymbol.endsWith(".T")) {
    return buildInstrumentId("TSE", yahooSymbol.slice(0, -2));
  }
  return buildInstrumentId(fallbackExchange, yahooSymbol);
};

/** Finnhub 形式（米国はそのまま、東証は `.T`）。Finnhub 無料枠は US 中心。 */
export const toFinnhubSymbol = (parsed: ParsedInstrumentId): string =>
  parsed.market === "JP" ? `${parsed.symbol}.T` : parsed.symbol;

/** J-Quants 形式（東証 4 桁コード。`7203` のように銘柄部のみ）。 */
export const toJQuantsCode = (parsed: ParsedInstrumentId): string =>
  parsed.symbol;
