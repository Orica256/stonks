import { describe, expect, it } from "vitest";
import type { MarginType, TaxLot } from "@stonks/contracts";
import {
  taxLotData,
  toTaxLot,
} from "../src/persistence/prisma-portfolio.repository.js";

/**
 * 税ロット永続層マッパの round-trip（Phase 8: CASH/MARGIN 区分の往復）。
 *
 * ローカル DB 無しで green にするため、Prisma を介さず純粋マッパ関数同士を結合して
 * 「contracts.TaxLot → DB data → DB 行 → contracts.TaxLot」の往復を検証する。
 * 区分情報（marginType）が欠落・改変なく往復することを保証する。
 */
describe("apps/api tax-lot persistence mapper — marginType round-trip", () => {
  const base: Omit<TaxLot, "marginType"> = {
    id: "lot-1",
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    quantity: 100,
    remainingQuantity: 100,
    costBasis: "2000",
    currency: "JPY",
    acquiredAt: "2026-06-24T00:00:00.000Z",
    method: "AVERAGE",
    taxAccountType: "SPECIFIC",
  };

  /** taxLotData の出力を DB 行（acquiredTradeId は NULL 既定）に見立てて toTaxLot に渡す。 */
  const roundTrip = (lot: TaxLot): TaxLot => {
    const data = taxLotData(lot);
    return toTaxLot({
      id: data.id,
      accountId: data.accountId,
      instrumentId: data.instrumentId,
      quantity: data.quantity,
      remainingQuantity: data.remainingQuantity,
      costBasis: { toString: () => data.costBasis },
      currency: data.currency as TaxLot["currency"],
      acquiredAt: data.acquiredAt,
      method: data.method,
      taxAccountType: data.taxAccountType,
      marginType: data.marginType as MarginType,
      acquiredTradeId: data.acquiredTradeId ?? null,
    });
  };

  it("persists an explicit CASH marginType and restores it", () => {
    const lot: TaxLot = { ...base, marginType: "CASH" };
    expect(taxLotData(lot).marginType).toBe("CASH");
    expect(roundTrip(lot).marginType).toBe("CASH");
  });

  it("persists MARGIN and restores it (区分が DB を往復する)", () => {
    const lot: TaxLot = { ...base, marginType: "MARGIN" };
    expect(taxLotData(lot).marginType).toBe("MARGIN");
    expect(roundTrip(lot).marginType).toBe("MARGIN");
  });

  it("falls back unspecified marginType to CASH (現物後方互換: DB 既定に頼らず明示)", () => {
    const lot = { ...base } as TaxLot; // marginType 未指定
    // 書き込み時に明示的に CASH を持たせる（DB 既定に頼らない）。
    expect(taxLotData(lot).marginType).toBe("CASH");
    // 復元時は DB の CASH がそのまま載る。
    expect(roundTrip(lot).marginType).toBe("CASH");
  });
});
