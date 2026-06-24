"use client";

import { useMemo } from "react";
import type { Trade } from "@stonks/contracts";
import { useInstrumentMap, useTrades } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  errorMessage,
  formatMoney,
  formatQuantity,
  formatTimestamp,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  resolveInstrumentDisplay,
  type InstrumentDisplay,
} from "@/lib/instrument-display";
import { DEFAULT_ACCOUNT_ID } from "@/lib/env";

/**
 * 取引履歴画面（spec §2.3）。約定（Trade）の一覧を新しい順に表示する。
 *
 * 銘柄は「取引所バッジ＋symbol＋銘柄名」で表示し、金額は銘柄通貨で整形する
 * （OpenOrdersPanel と同じ表示流儀。Phase 6.3 の改善を取引履歴へ展開）。
 * instrument 解決は `useInstrumentMap` でユニーク id をまとめて取得し、未解決
 * （ローディング/404/エラー）でも `parseInstrumentId` フォールバックで縮退する
 * （捏造しない。CLAUDE.md §7）。投資判断を促す表現は置かない。
 */
export default function HistoryPage(): JSX.Element {
  const trades = useTrades(DEFAULT_ACCOUNT_ID);

  // 一覧に出る instrumentId のユニーク集合だけを解決し、行ごとの N+1 取得を避ける。
  const instrumentIds = useMemo(
    () =>
      Array.from(new Set((trades.data ?? []).map((t) => t.instrumentId))),
    [trades.data],
  );
  const instrumentMap = useInstrumentMap(instrumentIds);

  const sorted = useMemo(
    () =>
      [...(trades.data ?? [])].sort((a, b) =>
        b.executedAt.localeCompare(a.executedAt),
      ),
    [trades.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>取引履歴</CardTitle>
      </CardHeader>
      <CardContent>
        {trades.isLoading ? (
          <LoadingState />
        ) : trades.isError ? (
          <ErrorState message={errorMessage(trades.error)} />
        ) : sorted.length === 0 ? (
          <EmptyState>約定はまだありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">約定日時</th>
                  <th className="py-2 pr-4">銘柄</th>
                  <th className="py-2 pr-4">売買</th>
                  <th className="py-2 pr-4 text-right">数量</th>
                  <th className="py-2 pr-4 text-right">約定単価</th>
                  <th className="py-2 pr-4 text-right">手数料</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <TradeRow
                    key={t.id}
                    trade={t}
                    display={resolveInstrumentDisplay(
                      t.instrumentId,
                      instrumentMap.get(t.instrumentId),
                    )}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 約定 1 件の行表示（銘柄＝取引所バッジ＋symbol＋名、金額は通貨整形）。 */
function TradeRow({
  trade,
  display,
}: {
  trade: Trade;
  /** instrumentId を解決した表示情報（未解決時は parseInstrumentId フォールバック）。 */
  display: InstrumentDisplay;
}): JSX.Element {
  // 通貨は instrument 解決優先、無ければ Trade 自身の通貨で整形する。
  // どちらも無ければ DecimalString 素表示に縮退する（捏造しない）。
  const currency = display.currency ?? trade.currency;
  const fmt = (value: string): string =>
    currency ? formatMoney(value, currency) : value;

  return (
    <tr className="border-t border-neutral-100">
      <td className="py-2 pr-4 text-neutral-500">
        {formatTimestamp(trade.executedAt)}
      </td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {display.exchange && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-neutral-500">
              {display.exchange}
            </span>
          )}
          <span className="font-medium text-neutral-700">{display.symbol}</span>
          {display.name && (
            <span className="text-neutral-500">（{display.name}）</span>
          )}
        </div>
      </td>
      <td
        className={cn(
          "py-2 pr-4 font-medium",
          trade.side === "BUY" ? "text-gain" : "text-loss",
        )}
      >
        {trade.side === "BUY" ? "買い" : "売り"}
      </td>
      <td className="py-2 pr-4 text-right">{formatQuantity(trade.quantity)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmt(trade.price)}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-neutral-500">
        {fmt(trade.fee)}
      </td>
    </tr>
  );
}
