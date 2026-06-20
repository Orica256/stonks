"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar } from "@stonks/contracts";

/**
 * lightweight-charts によるローソク足描画（spec §2.4, §3）。
 * バーは contracts の PriceBar（DecimalString）を受け取り、表示用に数値化する。
 */
export function CandleChart({ bars }: { bars: PriceBar[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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
    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    chartRef.current = chart;
    seriesRef.current = series;

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

  // データ更新時にシリーズへ反映。
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(toCandles(bars));
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return <div ref={containerRef} className="w-full" />;
}

/** PriceBar[] を lightweight-charts のロウソク足データへ変換する（表示用整形のみ）。 */
function toCandles(bars: PriceBar[]): CandlestickData[] {
  return bars
    .map((bar) => ({
      time: (Math.floor(new Date(bar.ts).getTime() / 1000) as UTCTimestamp) as Time,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    );
}
