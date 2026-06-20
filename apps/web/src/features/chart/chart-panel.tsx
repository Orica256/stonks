"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Instrument, Timeframe } from "@stonks/contracts";
import { useBars } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

// lightweight-charts はブラウザ専用 API（canvas）を使うため SSR を無効化する。
const CandleChart = dynamic(
  () => import("./candle-chart").then((m) => m.CandleChart),
  { ssr: false, loading: () => <LoadingState label="チャートを準備中…" /> },
);

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "1d"];

/** ローソク足チャートパネル（spec §6.8 GET /instruments/:id/bars）。 */
export function ChartPanel({
  instrument,
}: {
  instrument: Instrument | null;
}): JSX.Element {
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const query = useBars(instrument?.id, timeframe);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>
          チャート
          {instrument ? ` · ${instrument.symbol}` : ""}
        </CardTitle>
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                timeframe === tf
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:bg-neutral-100",
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {!instrument ? (
          <EmptyState>銘柄を選択するとチャートを表示します。</EmptyState>
        ) : query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="チャートデータの取得に失敗しました。" />
        ) : (query.data?.length ?? 0) === 0 ? (
          <EmptyState>この時間足のデータがありません。</EmptyState>
        ) : (
          <CandleChart bars={query.data ?? []} />
        )}
      </CardContent>
    </Card>
  );
}
