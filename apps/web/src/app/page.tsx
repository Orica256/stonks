"use client";

import { InstrumentSearch } from "@/features/instruments/instrument-search";
import { QuotePanel } from "@/features/instruments/quote-panel";
import { CorporateActionsPanel } from "@/features/instruments/corporate-actions-panel";
import { ChartPanel } from "@/features/chart/chart-panel";
import { OrderForm } from "@/features/order/order-form";
import { BracketOrderForm } from "@/features/order/bracket-order-form";
import { useSelectionStore } from "@/stores/selection-store";
import { DEFAULT_ACCOUNT_ID } from "@/lib/env";

/**
 * トレード画面（spec §2.2/§2.4）。銘柄検索→気配/チャート確認→発注を 1 画面で行う。
 * 選択中の銘柄は Zustand（selection-store）で共有する。
 */
export default function TradePage(): JSX.Element {
  const selected = useSelectionStore((s) => s.selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-6">
        <InstrumentSearch />
        <QuotePanel instrument={selected} />
        <OrderForm accountId={DEFAULT_ACCOUNT_ID} instrument={selected} />
        <BracketOrderForm accountId={DEFAULT_ACCOUNT_ID} instrument={selected} />
      </div>
      <div className="space-y-6">
        <ChartPanel instrument={selected} />
        <CorporateActionsPanel
          accountId={DEFAULT_ACCOUNT_ID}
          instrument={selected}
        />
      </div>
    </div>
  );
}
