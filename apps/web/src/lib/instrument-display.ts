import {
  parseInstrumentId,
  type Currency,
  type Exchange,
  type Instrument,
} from "@stonks/contracts";

/**
 * 一覧（オープン注文など）で instrumentId を「シンボル・銘柄名・通貨」に解決する
 * 表示ヘルパ（Phase 6）。`Instrument`（`GET /instruments/:id`）が解決済みならそれを使い、
 * 未解決（ローディング/404/エラー）でも `parseInstrumentId` のフォールバックで壊さない。
 *
 * データを捏造しない（CLAUDE.md §7 / 課題指示）: 名前が無いのに偽名を作らず、name は
 * 解決済みの場合だけ返す。通貨も Instrument 優先、無ければ exchange から導出する。
 */

/** 取引所から基軸通貨を導出する（TSE→JPY、NYSE/NASDAQ→USD）。 */
export function currencyOfExchange(exchange: Exchange): Currency {
  return exchange === "TSE" ? "JPY" : "USD";
}

/** 取引所の短い表示ラベル（バッジ用）。 */
export function exchangeLabel(exchange: Exchange): string {
  return exchange;
}

/** 一覧の銘柄表示に必要な解決結果。 */
export interface InstrumentDisplay {
  /** 銘柄シンボル（例 "7203" / "AAPL"）。解決不能時は instrumentId 生文字列。 */
  symbol: string;
  /** 銘柄名。Instrument 未解決時は undefined（捏造しない）。 */
  name: string | undefined;
  /** 取引所。parseInstrumentId も失敗したら undefined。 */
  exchange: Exchange | undefined;
  /** 価格整形に使う通貨。Instrument 優先、無ければ exchange から導出。両方不能なら undefined。 */
  currency: Currency | undefined;
}

/**
 * instrumentId と（あれば）解決済み Instrument から表示用情報を組み立てる。
 *
 * 優先順位:
 * 1. Instrument が解決済み → symbol/name/exchange/currency をそのまま使う。
 * 2. 未解決でも `parseInstrumentId` が成功 → symbol/exchange を使い通貨は exchange から導出。
 * 3. いずれも不能 → symbol は instrumentId の生文字列、name/exchange/currency は undefined。
 */
export function resolveInstrumentDisplay(
  instrumentId: string,
  instrument: Instrument | undefined,
): InstrumentDisplay {
  if (instrument) {
    return {
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.exchange,
      currency: instrument.currency,
    };
  }
  const parsed = parseInstrumentId(instrumentId);
  if (parsed) {
    return {
      symbol: parsed.symbol,
      name: undefined,
      exchange: parsed.exchange,
      currency: currencyOfExchange(parsed.exchange),
    };
  }
  return {
    symbol: instrumentId,
    name: undefined,
    exchange: undefined,
    currency: undefined,
  };
}
