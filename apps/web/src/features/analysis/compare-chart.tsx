"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { NormalizedSeries } from "./lib/compare";

/**
 * 複数銘柄の正規化リターンを重ねて描く折れ線チャート（spec §2.4 P2「複数銘柄比較」）。
 * 入力は正規化済み系列（基準値=100 等）。データ生成は純粋関数側（lib/compare）で行う。
 */
export function CompareChart({
  series,
}: {
  series: NormalizedSeries[];
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // instrumentId -> series ハンドル。差分で add/remove する。
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  // チャート生成は一度だけ。リサイズ監視を張る。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      height: 360,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#525252",
      },
      grid: {
        vertLines: { color: "#f5f5f5" },
        horzLines: { color: "#f5f5f5" },
      },
      rightPriceScale: { borderColor: "#e5e5e5" },
      timeScale: { borderColor: "#e5e5e5", timeVisible: true },
    });
    chartRef.current = chart;

    const resize = (): void => {
      chart.applyOptions({ width: container.clientWidth });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
    };
  }, []);

  // 系列の更新・追加・削除を差分適用する。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handles = seriesRef.current;
    const nextIds = new Set(series.map((s) => s.instrumentId));

    // 不要になった系列を除去。
    for (const [id, handle] of handles) {
      if (!nextIds.has(id)) {
        chart.removeSeries(handle);
        handles.delete(id);
      }
    }

    // 追加・更新。
    for (const s of series) {
      let handle = handles.get(s.instrumentId);
      if (!handle) {
        handle = chart.addLineSeries({ lineWidth: 2 });
        handles.set(s.instrumentId, handle);
      }
      handle.applyOptions({ color: s.color, title: s.label });
      handle.setData(toLineData(s));
    }

    chart.timeScale().fitContent();
  }, [series]);

  return <div ref={containerRef} className="w-full" />;
}

/** 正規化系列を lightweight-charts の折れ線データへ変換する（昇順・有限値のみ）。 */
function toLineData(s: NormalizedSeries): LineData[] {
  return s.points
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time))
    .map((p) => ({
      time: (p.time as UTCTimestamp) as Time,
      value: p.value,
    }));
}
