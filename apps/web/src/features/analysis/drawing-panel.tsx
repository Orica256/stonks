"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Instrument, Market, Timeframe } from "@stonks/contracts";
import { useBars, useInstruments } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { useDrawingStore } from "./drawing-store";
import { describeDrawing, type DrawMode } from "./lib/drawing";

// lightweight-charts はブラウザ専用（canvas）。SSR を無効化する。
const DrawingChart = dynamic(
  () => import("./drawing-chart").then((m) => m.DrawingChart),
  { ssr: false, loading: () => <LoadingState label="チャートを準備中…" /> },
);

const TIMEFRAMES: Timeframe[] = ["1d", "1h", "15m", "5m", "1m"];

const MARKET_OPTIONS: { value: Market | "ALL"; label: string }[] = [
  { value: "ALL", label: "すべて" },
  { value: "JP", label: "日本" },
  { value: "US", label: "米国" },
];

const MODES: { value: DrawMode; label: string; hint: string }[] = [
  { value: "none", label: "選択", hint: "作図しません（既存ラインの削除のみ）。" },
  {
    value: "horizontal",
    label: "水平線",
    hint: "チャートをクリックした価格に水平線を引きます。",
  },
  {
    value: "trendline",
    label: "トレンドライン",
    hint: "2 点をクリックすると線分を引きます。",
  },
];

/**
 * 描画ツールパネル（spec §2.4 P2「描画ツール」）。
 *
 * 単一銘柄のローソク足上に、ユーザーが水平線（価格ライン）とトレンドライン（2 点）を
 * 追加・削除する。すべてクライアント完結で、データは既存 §6.8 GET /instruments/:id/bars の再利用のみ。
 */
export function DrawingPanel(): JSX.Element {
  const instrument = useDrawingStore((s) => s.instrument);
  const mode = useDrawingStore((s) => s.mode);
  const drawings = useDrawingStore((s) => s.drawings);
  const pending = useDrawingStore((s) => s.pending);
  const setMode = useDrawingStore((s) => s.setMode);
  const handleClick = useDrawingStore((s) => s.handleClick);
  const cancelPending = useDrawingStore((s) => s.cancelPending);
  const remove = useDrawingStore((s) => s.remove);
  const clear = useDrawingStore((s) => s.clear);

  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const barsQuery = useBars(instrument?.id, timeframe);
  const bars = barsQuery.data ?? [];
  const activeHint = MODES.find((m) => m.value === mode)?.hint ?? "";

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <SymbolPicker />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            描画ツール
            {instrument ? (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {instrument.symbol}
              </span>
            ) : null}
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

        <CardContent className="space-y-3">
          {!instrument ? (
            <EmptyState>
              左で銘柄を選ぶと、ローソク足の上に水平線・トレンドラインを描けます。
            </EmptyState>
          ) : barsQuery.isLoading ? (
            <LoadingState label="バーデータを取得中…" />
          ) : barsQuery.isError ? (
            <ErrorState message="バーの取得に失敗しました。API が起動しているか確認してください。" />
          ) : bars.length === 0 ? (
            <EmptyState>この銘柄・時間軸のバーがありません。</EmptyState>
          ) : (
            <>
              {/* ツールバー */}
              <div className="flex flex-wrap items-center gap-1.5">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === m.value
                        ? "bg-neutral-900 text-white"
                        : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
                {drawings.length > 0 ? (
                  <button
                    type="button"
                    onClick={clear}
                    className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
                  >
                    すべて消去
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-neutral-500">
                {activeHint}
                {pending ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={cancelPending}
                      className="font-medium text-neutral-700 underline"
                    >
                      1 点目を取り消す
                    </button>
                  </>
                ) : null}
              </p>

              <DrawingChart
                bars={bars}
                drawings={drawings}
                mode={mode}
                onClickPoint={handleClick}
              />

              {drawings.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {drawings.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1"
                    >
                      <span className="text-neutral-600">
                        {describeDrawing(d)}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(d.id)}
                        className="text-neutral-400 hover:text-neutral-700"
                        aria-label="この作図を削除"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="text-xs text-neutral-400">
                作図はチャート表示のための補助線です。投資判断の根拠ではありません。
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 描画対象の単一銘柄を選ぶピッカー（spec §6.8 GET /instruments を再利用）。 */
function SymbolPicker(): JSX.Element {
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const instrument = useDrawingStore((s) => s.instrument);
  const setInstrument = useDrawingStore((s) => s.setInstrument);

  const query = useInstruments(input, market === "ALL" ? undefined : market);

  return (
    <Card>
      <CardHeader>
        <CardTitle>作図対象</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {instrument ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 px-2 py-1.5 text-xs">
            <span className="font-medium text-neutral-800">
              {instrument.symbol}
              <span className="ml-1.5 text-neutral-400">
                {instrument.exchange}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setInstrument(undefined)}
              className="text-neutral-400 hover:text-neutral-700"
              aria-label="作図対象を解除"
            >
              ×
            </button>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">
            描画したい銘柄を検索して選んでください。
          </p>
        )}

        <div className="flex gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="銘柄名・コード（例: 7203, AAPL）"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            aria-label="作図対象の銘柄検索"
          />
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as Market | "ALL")}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            aria-label="市場フィルタ"
          >
            {MARKET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {input.trim().length === 0 ? (
          <EmptyState>検索語を入力してください。</EmptyState>
        ) : query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="銘柄の取得に失敗しました。API が起動しているか確認してください。" />
        ) : (query.data?.length ?? 0) === 0 ? (
          <EmptyState>該当する銘柄がありません。</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {query.data?.map((inst) => (
              <PickerRow
                key={inst.id}
                instrument={inst}
                active={instrument?.id === inst.id}
                onSelect={() => setInstrument(inst)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PickerRow({
  instrument,
  active,
  onSelect,
}: {
  instrument: Instrument;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center justify-between px-2 py-2 text-left text-sm transition-colors hover:bg-neutral-50",
          active && "bg-neutral-100",
        )}
      >
        <span className="flex flex-col">
          <span className="font-medium text-neutral-900">
            {instrument.symbol}
            <span className="ml-2 text-xs text-neutral-400">
              {instrument.exchange}
            </span>
          </span>
          <span className="text-xs text-neutral-500">{instrument.name}</span>
        </span>
        <span className="text-xs text-neutral-400">{instrument.currency}</span>
      </button>
    </li>
  );
}
