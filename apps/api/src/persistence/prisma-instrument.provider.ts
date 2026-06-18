import type { Instrument } from "@stonks/contracts";
import type { InstrumentProvider } from "@stonks/trading-engine";
import type { PrismaClient } from "@stonks/db";
import { toInstrument } from "./mappers.js";

/**
 * trading-engine の InstrumentProvider ポートを Prisma で実装する。
 * 銘柄 ID は EXCHANGE:SYMBOL を正準形式として Instrument.id に格納する想定
 * （market-data の parseInstrumentId と突き合わせるためのブリッジ。詳細は README/報告参照）。
 */
export class PrismaInstrumentProvider implements InstrumentProvider {
  constructor(private readonly db: PrismaClient) {}

  async getById(instrumentId: string): Promise<Instrument | null> {
    const row = await this.db.instrument.findUnique({
      where: { id: instrumentId },
    });
    return row ? toInstrument(row) : null;
  }
}
