"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Instrument, PriceBar, Timeframe } from "@stonks/contracts";
import { useBars } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { useAnalysisStore } from "./analysis-store";
import { normalizeBars, seriesReturn, type NormalizedSeries } from "./lib/compare";
import { seriesColor } from "./lib/palette";

// lightweight-charts はブラウザ専用（canvas）。SSR を無効化する。
const CompareChart = dynamic(
  () => import("./compare-chart").then((m) => m.CompareChart),
  { ssr: false, loading: () => <LoadingState label="チャートを準備中…" /> },
);

const TIMEFRAMES: Timeframe[] = ["1d", "1h", "15m", "5m", "1m"];
const BASE = 100;

/**
 * 複数銘柄比較パネル（spec §2.4 P2）。
 * 選択中の各銘柄について GET /instruments/:id/bars を叩き、正規化リターンを重ねる。
 */
export function ComparePanel(): JSX.Element {
  const instruments = useAnalysisStore((s) => s.instruments);
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  // 子（BarsLoader）が報告する instrumentId -> bars。
  const [barsById, setBarsById] = useState<Record<string, PriceBar[]>>({});

  const report = useCallback((id: string, bars: PriceBar[]) => {
    setBarsById((prev) =>
      prev[id] === bars ? prev : { ...prev, [id]: bars },
    );
  }, []);

  const series: NormalizedSeries[] = instruments.map((inst, index) => ({
    instrumentId: inst.id,
    label: inst.symbol,
    color: seriesColor(index),
    points: normalizeBars(barsById[inst.id] ?? [], BASE),
  }));

  const ready = series.some((s) => s.points.length > 0);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>正規化リターン比較（基準 = {BASE}）</CardTitle>
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
      <CardContent className="space-y-3">
        {/* 各銘柄ぶんのデータ取得（フックを子コンポーネントに閉じる）。 */}
        {instruments.map((inst) => (
          <BarsLoader
            key={`${inst.id}:${timeframe}`}
            instrument={inst}
            timeframe={timeframe}
            onData={report}
          />
        ))}

        {instruments.length === 0 ? (
          <EmptyState>
            左で銘柄を追加すると、基準日を 100 とした相対リターンで重ねて比較します。
          </EmptyState>
        ) : !ready ? (
          <LoadingState label="バーデータを取得中…" />
        ) : (
          <>
            <CompareChart series={series} />
            <ul className="flex flex-wrap gap-3 text-xs">
              {series.map((s) => {
                const ret = seriesReturn(s.points, BASE);
                return (
                  <li key={s.instrumentId} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    <span className="font-medium text-neutral-700">
                      {s.label}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {ret === undefined ? "—" : formatPercent(ret)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-neutral-400">
              基準日からの相対変化を示す指数表示です。投資判断の根拠ではありません。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 1 銘柄ぶんのバー取得を担う内部コンポーネント。
 * フックを銘柄ごとに分離し、取得結果を親へ報告する（フックのループ呼びを避ける）。
 */
function BarsLoader({
  instrument,
  timeframe,
  onData,
}: {
  instrument: Instrument;
  timeframe: Timeframe;
  onData: (id: string, bars: PriceBar[]) => void;
}): null {
  const query = useBars(instrument.id, timeframe);
  const data = query.data;
  // データ確定時のみ親へ通知（参照同一なら親側で no-op）。
  useEffect(() => {
    if (data) onData(instrument.id, data);
  }, [data, instrument.id, onData]);
  return null;
}
