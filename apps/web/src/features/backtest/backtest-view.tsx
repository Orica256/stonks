"use client";

import { useMemo, useState } from "react";
import type { Instrument, RunBacktestRequest, Timeframe } from "@stonks/contracts";
import { useRunBacktest } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/format";
import { BacktestResultView } from "./backtest-result";
import { InstrumentSelect } from "./instrument-select";
import {
  STRATEGY_PRESETS,
  findPreset,
  type StrategyPresetId,
} from "./lib/strategy";

/** バックテストで選べる時間足（spec の Timeframe の実用的な部分集合）。 */
const TIMEFRAMES: Timeframe[] = ["1d", "1h", "15m"];

/** 期間入力（YYYY-MM-DD）を UTC の ISO8601 タイムスタンプへ。日初を採用。 */
function dateToUtcStart(date: string): string | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** 既定の期間（直近 1 年）を YYYY-MM-DD で返す。 */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * バックテスト画面（spec §2.5）。対象銘柄・期間・初期資金・戦略プリセットを選び、
 * `POST /backtests`（spec §6.8）を実行して指標とエクイティカーブを表示する。
 * 入力は contracts の RunBacktestRequest を組み立てるだけ（手書きレスポンス型なし）。
 */
export function BacktestView(): JSX.Element {
  const initial = useMemo(defaultRange, []);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [initialCash, setInitialCash] = useState("1000000");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [presetId, setPresetId] = useState<StrategyPresetId>("sma-cross");

  const mutation = useRunBacktest();

  const preset = findPreset(presetId);
  const fromTs = dateToUtcStart(from);
  const toTs = dateToUtcStart(to);
  const cashValid = /^\d+(\.\d+)?$/.test(initialCash.trim());

  const validationError = (() => {
    if (!instrument) return "銘柄を選択してください。";
    if (!fromTs || !toTs) return "開始日・終了日を正しく入力してください。";
    if (Date.parse(fromTs) >= Date.parse(toTs))
      return "開始日は終了日より前にしてください。";
    if (!cashValid) return "初期資金は正の数で入力してください。";
    if (!preset) return "戦略を選択してください。";
    return null;
  })();

  const submit = (): void => {
    if (validationError || !instrument || !preset || !fromTs || !toTs) return;
    const request: RunBacktestRequest = {
      strategy: preset.build({ universe: [instrument.id], timeframe }),
      range: { from: fromTs, to: toTs },
      initialCash: initialCash.trim(),
    };
    mutation.mutate(request);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-neutral-900">バックテスト</h1>
        <p className="text-sm text-neutral-500">
          過去データに対してルールベース戦略を検証します。結果はシミュレーションであり、投資助言ではありません。
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>条件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section className="space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">
                対象銘柄
              </span>
              <InstrumentSelect
                selected={instrument}
                onSelect={setInstrument}
              />
            </section>

            <section className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-neutral-600">
                  開始日
                </span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-neutral-600">
                  終了日
                </span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                />
              </label>
            </section>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">
                初期資金
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={initialCash}
                onChange={(e) => setInitialCash(e.target.value)}
                placeholder="1000000"
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums focus:border-neutral-500 focus:outline-none"
              />
            </label>

            <section className="space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">
                時間足
              </span>
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
            </section>

            <section className="space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">戦略</span>
              <select
                value={presetId}
                onChange={(e) =>
                  setPresetId(e.target.value as StrategyPresetId)
                }
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                aria-label="戦略プリセット"
              >
                {STRATEGY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {preset ? (
                <p className="text-xs text-neutral-400">{preset.description}</p>
              ) : null}
            </section>

            <div className="space-y-2 pt-1">
              <Button
                onClick={submit}
                disabled={Boolean(validationError) || mutation.isPending}
                className="w-full"
              >
                {mutation.isPending ? "実行中…" : "バックテストを実行"}
              </Button>
              {validationError ? (
                <p className="text-xs text-neutral-400">{validationError}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div>
          {mutation.isPending ? (
            <LoadingState label="バックテストを実行中…" />
          ) : mutation.isError ? (
            <ErrorState message={errorMessage(mutation.error)} />
          ) : mutation.data ? (
            <BacktestResultView result={mutation.data} />
          ) : (
            <Card>
              <CardContent>
                <EmptyState>
                  左で条件を設定し「バックテストを実行」を押すと、成績指標とエクイティカーブを表示します。
                </EmptyState>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
