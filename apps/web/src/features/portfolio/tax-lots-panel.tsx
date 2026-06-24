"use client";

import { useMemo, useState } from "react";
import type { CostBasisMethod, TaxLot } from "@stonks/contracts";
import { useInstrumentMap, useTaxLots } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MarginBadge } from "@/components/ui/margin-badge";
import { cn } from "@/lib/cn";
import { formatMoney, formatQuantity, formatTimestamp } from "@/lib/format";
import {
  resolveInstrumentDisplay,
  type InstrumentDisplay,
} from "@/lib/instrument-display";

/**
 * 税ロット内訳パネル（spec §2.3 P2 / §5.1 TaxLot。Phase 8.1。
 * GET /accounts/:id/tax-lots）。
 *
 * 取得（現物買い/買い建て）ごとの税ロットを可視化する。Phase 8 で導入した
 * 建玉別（CASH/MARGIN）税ロット分離の成果を、行ごとの資金区分バッジ（MarginBadge）で示す。
 * 残数量・取得数量・取得単価（DecimalString を表示整形のみ）・取得日・取得単価計算方式を並べる。
 *
 * 未決済（remainingQuantity>0）のみ表示するトグルを持つ（既定は全件表示で、クローズ済みは
 * 薄く表示）。投資判断を促す表現は置かない（CLAUDE.md §7 / spec §9）。
 */
export function TaxLotsPanel({
  accountId,
}: {
  accountId: string;
}): JSX.Element {
  const [openOnly, setOpenOnly] = useState(false);
  const query = useTaxLots(accountId, openOnly);

  // 一覧に出る instrumentId のユニーク集合だけを解決し、行ごとの N+1 取得を避ける。
  const instrumentIds = useMemo(
    () =>
      Array.from(new Set((query.data ?? []).map((lot) => lot.instrumentId))),
    [query.data],
  );
  const instrumentMap = useInstrumentMap(instrumentIds);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>税ロット内訳</CardTitle>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            未決済のみ
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="税ロットの取得に失敗しました。" />
        ) : !query.data || query.data.length === 0 ? (
          <EmptyState>税ロットはありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">銘柄</th>
                  <th className="py-2 pr-4">区分</th>
                  <th className="py-2 pr-4 text-right">残数量／取得</th>
                  <th className="py-2 pr-4 text-right">取得単価</th>
                  <th className="py-2 pr-4">取得日</th>
                  <th className="py-2 pr-4">方式</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((lot) => (
                  <TaxLotRow
                    key={lot.id}
                    lot={lot}
                    display={resolveInstrumentDisplay(
                      lot.instrumentId,
                      instrumentMap.get(lot.instrumentId),
                    )}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          取得ごとの税ロット内訳です（残数量が 0 のロットはクローズ済み）。取得単価は表示整形のみで、
          損益通算・繰越控除・口座区分の細目は反映しません。投資助言ではありません。
        </p>
      </CardContent>
    </Card>
  );
}

/** 取得単価計算方式の表示ラベル（事実のみ）。 */
function methodLabel(method: CostBasisMethod): string {
  switch (method) {
    case "AVERAGE":
      return "平均";
    case "FIFO":
      return "FIFO";
    case "LIFO":
      return "LIFO";
    case "SPECIFIC_LOT":
      return "指定ロット";
  }
}

/** 1 税ロットの行表示。クローズ済み（残 0）は薄く表示する。 */
function TaxLotRow({
  lot,
  display,
}: {
  lot: TaxLot;
  /** instrumentId を解決した表示情報（未解決時は parseInstrumentId フォールバック）。 */
  display: InstrumentDisplay;
}): JSX.Element {
  const isClosed = lot.remainingQuantity === 0;
  // 取得単価は銘柄の通貨で整形する。通貨が解決できなければ素表示に縮退（捏造しない）。
  const costBasis = display.currency
    ? formatMoney(lot.costBasis, display.currency)
    : lot.costBasis;

  return (
    <tr
      className={cn(
        "border-t border-neutral-100",
        isClosed && "text-neutral-400",
      )}
    >
      <td className="py-2 pr-4 font-medium">
        <div className="flex flex-wrap items-center gap-1.5">
          {display.exchange && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-neutral-500">
              {display.exchange}
            </span>
          )}
          <span>{display.symbol}</span>
          {display.name && (
            <span className="font-normal text-neutral-500">
              （{display.name}）
            </span>
          )}
        </div>
      </td>
      <td className="py-2 pr-4">
        <MarginBadge marginType={lot.marginType} />
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {formatQuantity(lot.remainingQuantity)}／
        {formatQuantity(lot.quantity)}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{costBasis}</td>
      <td className="py-2 pr-4 text-neutral-500">
        {formatTimestamp(lot.acquiredAt)}
      </td>
      <td className="py-2 pr-4 text-neutral-500">{methodLabel(lot.method)}</td>
    </tr>
  );
}
