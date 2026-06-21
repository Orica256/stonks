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
import type { EquityChartPoint } from "./lib/equity";

/**
 * バックテストのエクイティカーブ（口座評価額の推移）を描く折れ線チャート（spec §2.5）。
 * データ生成は純粋関数側（lib/equity.toEquityChart）で行い、ここは描画のみ。
 * lightweight-charts はブラウザ専用なので呼び出し側で `dynamic(ssr:false)` する。
 */
export function EquityChart({
  points,
}: {
  points: EquityChartPoint[];
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

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
      timeScale: { borderColor: "#e5e5e5", timeVisible: false },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addAreaSeries({
      lineColor: "#171717",
      topColor: "rgba(23, 23, 23, 0.16)",
      bottomColor: "rgba(23, 23, 23, 0.01)",
      lineWidth: 2,
    });

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
      seriesRef.current = null;
    };
  }, []);

  // 点の更新を反映する。
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    series.setData(toLineData(points));
    chart.timeScale().fitContent();
  }, [points]);

  return <div ref={containerRef} className="w-full" />;
}

/** エクイティ点を lightweight-charts の折れ線データへ変換する（有限値のみ）。 */
function toLineData(points: EquityChartPoint[]): LineData[] {
  return points
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time))
    .map((p) => ({
      time: (p.time as UTCTimestamp) as Time,
      value: p.value,
    }));
}
