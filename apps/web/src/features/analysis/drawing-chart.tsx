"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar } from "@stonks/contracts";
import type { Drawing, DrawMode, LinePoint } from "./lib/drawing";
import { toLinePoint } from "./lib/drawing";

/**
 * 作図対応のローソク足チャート（spec §2.4 P2「描画ツール」）。
 *
 * 既存 candle-chart の lightweight-charts 利用パターンを踏襲しつつ、
 * - 水平線は series.createPriceLine（価格ライン）
 * - トレンドラインは 2 点の独立 LineSeries
 * で描く（ライブラリで素直に描ける範囲）。クリック→価格/時刻変換は純粋関数 toLinePoint へ委譲。
 *
 * 投資助言ではない（CLAUDE.md §7）。本コンポーネントは描画のみで判断を促さない。
 */
export function DrawingChart({
  bars,
  drawings,
  mode,
  onClickPoint,
}: {
  bars: PriceBar[];
  drawings: Drawing[];
  mode: DrawMode;
  onClickPoint: (point: LinePoint) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // id -> 水平線ハンドル。
  const priceLineRef = useRef<Map<string, IPriceLine>>(new Map());
  // id -> トレンドライン用の LineSeries ハンドル。
  const trendRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // 最新のクリックハンドラを参照する（effect 再subscribe を避ける）。
  const clickRef = useRef(onClickPoint);
  clickRef.current = onClickPoint;
  // 最新のモードを参照する（クリック時のカーソル無効判定などに使用）。
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // チャート生成は一度だけ。リサイズ監視・クリック購読を張る。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      height: 420,
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
      crosshair: { mode: 0 },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    chartRef.current = chart;
    candleRef.current = candle;

    const handleClick = (param: MouseEventParams): void => {
      if (modeRef.current === "none") return;
      const point = param.point;
      if (!point) return;
      const price = candle.coordinateToPrice(point.y);
      const time = chart.timeScale().coordinateToTime(point.x);
      const linePoint = toLinePoint(
        toNumber(time),
        price === null ? undefined : Number(price),
      );
      if (linePoint) clickRef.current(linePoint);
    };
    chart.subscribeClick(handleClick);

    const resize = (): void => {
      chart.applyOptions({ width: container.clientWidth });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.unsubscribeClick(handleClick);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      priceLineRef.current.clear();
      trendRef.current.clear();
    };
  }, []);

  // ローソク足データ更新。
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    candle.setData(toCandles(bars));
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  // 作図（水平線/トレンドライン）の差分適用。
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;

    const priceLines = priceLineRef.current;
    const trends = trendRef.current;
    const nextIds = new Set(drawings.map((d) => d.id));

    // 不要になった作図を除去。
    for (const [id, handle] of priceLines) {
      if (!nextIds.has(id)) {
        candle.removePriceLine(handle);
        priceLines.delete(id);
      }
    }
    for (const [id, handle] of trends) {
      if (!nextIds.has(id)) {
        chart.removeSeries(handle);
        trends.delete(id);
      }
    }

    // 追加（既存 id は維持。作図は不変前提なので更新はしない）。
    for (const d of drawings) {
      if (d.kind === "horizontal") {
        if (!priceLines.has(d.id)) {
          priceLines.set(
            d.id,
            candle.createPriceLine({
              price: d.price,
              color: "#2563eb",
              lineWidth: 1,
              lineStyle: LineStyle.Solid,
              axisLabelVisible: true,
              title: "",
            }),
          );
        }
      } else if (!trends.has(d.id)) {
        const series = chart.addLineSeries({
          color: "#7c3aed",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData([
          { time: asTime(d.a.time), value: d.a.price },
          { time: asTime(d.b.time), value: d.b.price },
        ] satisfies LineData[]);
        trends.set(d.id, series);
      }
    }
  }, [drawings]);

  return <div ref={containerRef} className="w-full" />;
}

/** Time（UTCTimestamp 等）を UNIX 秒の number へ。非対応形式は undefined。 */
function toNumber(time: Time | null): number | undefined {
  if (time === null) return undefined;
  return typeof time === "number" ? time : undefined;
}

/** UNIX 秒を lightweight-charts の Time へ。 */
function asTime(seconds: number): Time {
  return (seconds as UTCTimestamp) as Time;
}

/** PriceBar[] を lightweight-charts のロウソク足データへ変換する（表示用整形のみ）。 */
function toCandles(bars: PriceBar[]): CandlestickData[] {
  return bars
    .map((bar) => ({
      time: asTime(Math.floor(new Date(bar.ts).getTime() / 1000)),
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
