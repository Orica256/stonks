import type { Currency, Exchange, Market } from "@stonks/contracts";
import {
  DomainError,
  buildInstrumentId as buildId,
  parseInstrumentId as parseId,
} from "@stonks/contracts";

/**
 * 銘柄コードの正規化（spec §2.1, §6.1）。
 *
 * 銘柄 ID の正準形式 `EXCHANGE:SYMBOL`（例 `TSE:7203` / `NASDAQ:AAPL`）は
 * contracts（B1）で確定済み。組み立て/分解は contracts の helper を再利用し、
 * ここでは market-data 固有の market/currency 導出とプロバイダ固有コード変換
 * （Yahoo の `7203.T`、Finnhub の `AAPL` 等）を担う。
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
  buildId(exchange, symbol);

/**
 * `EXCHANGE:SYMBOL` を market/currency 込みでパースする。未知形式は VALIDATION エラー。
 * 形式判定は contracts の parseInstrumentId に委譲し、市場/通貨を導出する。
 */
export const parseInstrumentId = (instrumentId: string): ParsedInstrumentId => {
  const parsed = parseId(instrumentId);
  if (!parsed) {
    throw new DomainError(
      "VALIDATION",
      `invalid instrumentId: "${instrumentId}" (expected EXCHANGE:SYMBOL)`,
    );
  }
  const market = EXCHANGE_MARKET[parsed.exchange];
  return {
    exchange: parsed.exchange,
    symbol: parsed.symbol.toUpperCase(),
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
