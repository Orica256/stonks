"use client";

import { useState } from "react";
import type { Instrument, Market } from "@stonks/contracts";
import { useInstruments } from "@/lib/api/hooks";
import { useSelectionStore } from "@/stores/selection-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

const MARKET_OPTIONS: { value: Market | "ALL"; label: string }[] = [
  { value: "ALL", label: "すべて" },
  { value: "JP", label: "日本" },
  { value: "US", label: "米国" },
];

/** 銘柄検索 + 結果一覧（spec §6.8 GET /instruments）。選択は Zustand に反映。 */
export function InstrumentSearch(): JSX.Element {
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const selected = useSelectionStore((s) => s.selected);
  const select = useSelectionStore((s) => s.select);

  const query = useInstruments(input, market === "ALL" ? undefined : market);

  return (
    <Card>
      <CardHeader>
        <CardTitle>銘柄検索</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="銘柄名・コード（例: 7203, AAPL）"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
            aria-label="銘柄検索"
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
              <InstrumentRow
                key={inst.id}
                instrument={inst}
                active={selected?.id === inst.id}
                onSelect={() => select(inst)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InstrumentRow({
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
