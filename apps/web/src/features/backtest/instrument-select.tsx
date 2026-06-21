"use client";

import { useState } from "react";
import type { Instrument, Market } from "@stonks/contracts";
import { useInstruments } from "@/lib/api/hooks";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

const MARKET_OPTIONS: { value: Market | "ALL"; label: string }[] = [
  { value: "ALL", label: "すべて" },
  { value: "JP", label: "日本" },
  { value: "US", label: "米国" },
];

/**
 * バックテスト対象の単一銘柄を選ぶピッカー（spec §6.8 GET /instruments を再利用）。
 * 選択結果（Instrument）は親へ通知する。バックテストは現状 1 銘柄ユニバースを対象とする。
 */
export function InstrumentSelect({
  selected,
  onSelect,
}: {
  selected: Instrument | null;
  onSelect: (instrument: Instrument) => void;
}): JSX.Element {
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<Market | "ALL">("ALL");

  const query = useInstruments(input, market === "ALL" ? undefined : market);

  return (
    <div className="space-y-2">
      {selected ? (
        <p className="text-sm text-neutral-700">
          選択中:{" "}
          <span className="font-medium text-neutral-900">
            {selected.symbol}
          </span>{" "}
          <span className="text-xs text-neutral-400">{selected.exchange}</span>
          <span className="ml-2 text-xs text-neutral-500">{selected.name}</span>
        </p>
      ) : (
        <p className="text-xs text-neutral-400">
          バックテストする銘柄を検索して 1 つ選んでください（例: 7203, AAPL）。
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="銘柄名・コード"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
          aria-label="バックテスト銘柄検索"
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

      {input.trim().length === 0 ? null : query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message="銘柄の取得に失敗しました。API が起動しているか確認してください。" />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState>該当する銘柄がありません。</EmptyState>
      ) : (
        <ul className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
          {query.data?.map((inst) => (
            <li key={inst.id}>
              <button
                type="button"
                onClick={() => onSelect(inst)}
                className={cn(
                  "flex w-full items-center justify-between px-2 py-2 text-left text-sm transition-colors",
                  selected?.id === inst.id
                    ? "bg-neutral-100"
                    : "hover:bg-neutral-50",
                )}
              >
                <span className="flex flex-col">
                  <span className="font-medium text-neutral-900">
                    {inst.symbol}
                    <span className="ml-2 text-xs text-neutral-400">
                      {inst.exchange}
                    </span>
                  </span>
                  <span className="text-xs text-neutral-500">{inst.name}</span>
                </span>
                <span className="text-xs text-neutral-400">
                  {selected?.id === inst.id ? "選択中" : "選択"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
