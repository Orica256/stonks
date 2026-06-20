import type { FxRate, Instrument, PriceBar, Quote } from "@stonks/contracts";
import type { PrismaClient } from "@stonks/db";

/**
 * 取込ワーカーの永続化ポート。
 *
 * ハンドラはこの IF にのみ依存し、テストではフェイクを差し込む（実 DB 非依存）。
 * 本番は PrismaIngestionRepository が @stonks/db 経由で OHLCV / Quote / FxRate /
 * Instrument を書き込む（PriceBar は TimescaleDB hypertable。spec §5.1）。
 */
export interface IngestionRepository {
  /** 銘柄マスタを upsert（取込時の参照整合性のため先に確保する）。 */
  upsertInstrument(instrument: Instrument): Promise<void>;
  /** 日足等の OHLCV をまとめて upsert（再取込で重複させない）。 */
  saveBars(bars: PriceBar[]): Promise<number>;
  /** 最新気配を追記保存（時系列のスナップショット）。 */
  saveQuote(quote: Quote): Promise<void>;
  /** 為替レートを追記保存。 */
  saveFxRate(rate: FxRate): Promise<void>;
}

const TF_TO_DB = {
  "1m": "m1",
  "5m": "m5",
  "15m": "m15",
  "1h": "h1",
  "1d": "d1",
} as const;

/** contracts の Timeframe（1m..1d）を db の別名（m1..d1）へ変換する。 */
const timeframeToDb = (tf: PriceBar["timeframe"]): "m1" | "m5" | "m15" | "h1" | "d1" =>
  TF_TO_DB[tf];

/**
 * Prisma による IngestionRepository 実装。
 *
 * - 金額は contracts では DecimalString、Prisma では Decimal なので文字列をそのまま渡す。
 * - 時刻は contracts では ISO 文字列(UTC)、Prisma では DateTime。
 * - PriceBar は (instrumentId, timeframe, ts) 複合主キーで upsert し冪等にする。
 */
export class PrismaIngestionRepository implements IngestionRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsertInstrument(instrument: Instrument): Promise<void> {
    await this.db.instrument.upsert({
      where: { id: instrument.id },
      create: {
        id: instrument.id,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        market: instrument.market,
        name: instrument.name,
        currency: instrument.currency,
        type: instrument.type,
        lotSize: instrument.lotSize,
        tickRules: instrument.tickRules,
        isActive: instrument.isActive,
      },
      update: {
        symbol: instrument.symbol,
        name: instrument.name,
        isActive: instrument.isActive,
      },
    });
  }

  async saveBars(bars: PriceBar[]): Promise<number> {
    let written = 0;
    for (const bar of bars) {
      const tf = timeframeToDb(bar.timeframe);
      await this.db.priceBar.upsert({
        where: {
          instrumentId_timeframe_ts: {
            instrumentId: bar.instrumentId,
            timeframe: tf,
            ts: new Date(bar.ts),
          },
        },
        create: {
          instrumentId: bar.instrumentId,
          timeframe: tf,
          ts: new Date(bar.ts),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
        update: {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
      });
      written += 1;
    }
    return written;
  }

  async saveQuote(quote: Quote): Promise<void> {
    await this.db.quote.create({
      data: {
        instrumentId: quote.instrumentId,
        last: quote.last,
        bid: quote.bid ?? null,
        ask: quote.ask ?? null,
        ts: new Date(quote.ts),
        source: quote.source,
      },
    });
  }

  async saveFxRate(rate: FxRate): Promise<void> {
    await this.db.fxRate.create({
      data: {
        base: rate.base,
        quote: rate.quote,
        rate: rate.rate,
        ts: new Date(rate.ts),
      },
    });
  }
}
