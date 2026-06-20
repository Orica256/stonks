"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { InstrumentPicker } from "./instrument-picker";
import { ComparePanel } from "./compare-panel";

/** 分析画面のタブ種別（spec §2.4 P2: 比較 / ヒートマップ / 描画ツール）。 */
type Tab = "compare" | "heatmap" | "draw";

const TABS: { value: Tab; label: string }[] = [
  { value: "compare", label: "複数銘柄比較" },
  { value: "heatmap", label: "ヒートマップ" },
  { value: "draw", label: "描画ツール" },
];

/**
 * 分析画面（spec §2.4 P2）。左に比較銘柄ピッカー、右にタブで各分析を切り替える。
 * すべてクライアント完結（描画）か、既存 §6.8 エンドポイントの再利用のみで成立させる。
 */
export function AnalysisView(): JSX.Element {
  const [tab, setTab] = useState<Tab>("compare");

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.value
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <InstrumentPicker />
        <div>
          {tab === "compare" ? (
            <ComparePanel />
          ) : (
            <PlaceholderTab label={TABS.find((t) => t.value === tab)?.label} />
          )}
        </div>
      </div>
    </div>
  );
}

function PlaceholderTab({ label }: { label?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-12 text-center text-sm text-neutral-400">
      {label} は準備中です。
    </div>
  );
}
