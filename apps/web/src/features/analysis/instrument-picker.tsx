"use client";

import { useState } from "react";
import type { Instrument, Market } from "@stonks/contracts";
import { useInstruments } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import {
  MAX_INSTRUMENTS,
  useAnalysisStore,
} from "./analysis-store";
import { seriesColor } from "./lib/palette";

const MARKET_OPTIONS: { value: Market | "ALL"; label: string }[] = [
  { value: "ALL", label: "すべて" },
  { value: "JP", label: "日本" },
  { value: "US", label: "米国" },
];

/**
 * 比較/ヒートマップ対象の銘柄を複数選ぶピッカー（spec §6.8 GET /instruments を再利用）。
 * 選択は Zustand（analysis-store）に反映し、最大 {@link MAX_INSTRUMENTS} 件まで。
 */
export function InstrumentPicker(): JSX.Element {
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const instruments = useAnalysisStore((s) => s.instruments);
  const add = useAnalysisStore((s) => s.add);
  const remove = useAnalysisStore((s) => s.remove);
  const clear = useAnalysisStore((s) => s.clear);

  const query = useInstruments(input, market === "ALL" ? undefined : market);
  const atLimit = instruments.length >= MAX_INSTRUMENTS;
  const selectedIds = new Set(instruments.map((i) => i.id));

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>比較銘柄</CardTitle>
        {instruments.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-neutral-500 hover:text-neutral-800"
          >
            すべて解除
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {instruments.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {instruments.map((inst, index) => (
              <li key={inst.id}>
                <button
                  type="button"
                  onClick={() => remove(inst.id)}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50"
                  aria-label={`${inst.symbol} を比較から外す`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: seriesColor(index) }}
                    aria-hidden
                  />
                  {inst.symbol}
                  <span aria-hidden className="text-neutral-400">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-400">
            比較したい銘柄を検索して追加してください（最大 {MAX_INSTRUMENTS} 件）。
          </p>
        )}

        <div className="flex gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="銘柄名・コード（例: 7203, AAPL）"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            aria-label="比較銘柄検索"
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

        {atLimit ? (
          <p className="text-xs text-neutral-400">
            上限（{MAX_INSTRUMENTS} 件）に達しています。外してから追加してください。
          </p>
        ) : input.trim().length === 0 ? (
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
                selected={selectedIds.has(inst.id)}
                onAdd={() => add(inst)}
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
  selected,
  onAdd,
}: {
  instrument: Instrument;
  selected: boolean;
  onAdd: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        disabled={selected}
        className={cn(
          "flex w-full items-center justify-between px-2 py-2 text-left text-sm transition-colors",
          selected
            ? "cursor-default text-neutral-400"
            : "hover:bg-neutral-50",
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
        <span className="text-xs text-neutral-400">
          {selected ? "追加済み" : "＋ 追加"}
        </span>
      </button>
    </li>
  );
}
