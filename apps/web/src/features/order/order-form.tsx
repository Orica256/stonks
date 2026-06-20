"use client";

import { useState, type FormEvent } from "react";
import type {
  Instrument,
  OrderSide,
  OrderType,
  PlaceOrderCommand,
  TimeInForce,
} from "@stonks/contracts";
import { usePlaceOrder } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * 注文入力（成行/指値。spec §6.8 POST /accounts/:id/orders）。
 *
 * 価格は浮動小数で送らず DecimalString（文字列）のまま送る（CLAUDE.md §0）。
 * 投資判断を促す表現は置かない（CLAUDE.md §7）。
 */
export function OrderForm({
  accountId,
  instrument,
}: {
  accountId: string;
  instrument: Instrument | null;
}): JSX.Element {
  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("DAY");
  const [localError, setLocalError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const mutation = usePlaceOrder(accountId);

  const needsLimit = type === "LIMIT" || type === "STOP_LIMIT";
  const needsStop = type === "STOP" || type === "STOP_LIMIT";

  function reset(): void {
    setQuantity("");
    setLimitPrice("");
    setStopPrice("");
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    setLocalError(null);
    setPlaced(null);

    if (!instrument) return;

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setLocalError("数量は 1 以上の数値を入力してください。");
      return;
    }
    if (needsLimit && !DECIMAL_RE.test(limitPrice)) {
      setLocalError("指値価格を正しく入力してください。");
      return;
    }
    if (needsStop && !DECIMAL_RE.test(stopPrice)) {
      setLocalError("逆指値価格を正しく入力してください。");
      return;
    }

    // PlaceOrderCommand（accountId はパス側で付与）。型は contracts から導出。
    const command: Omit<PlaceOrderCommand, "accountId"> = {
      instrumentId: instrument.id,
      side,
      type,
      quantity: qty,
      timeInForce,
      ...(needsLimit ? { limitPrice } : {}),
      ...(needsStop ? { stopPrice } : {}),
    };

    mutation.mutate(command, {
      onSuccess: (order) => {
        setPlaced(order.id);
        reset();
      },
    });
  }

  const submitError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? "発注に失敗しました。"
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>注文</CardTitle>
      </CardHeader>
      <CardContent>
        {!instrument ? (
          <EmptyState>銘柄を選択すると発注できます。</EmptyState>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="text-sm text-neutral-500">
              {instrument.symbol} · {instrument.name}（{instrument.currency}）
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SegmentedButton
                active={side === "BUY"}
                activeClass="bg-gain text-white"
                onClick={() => setSide("BUY")}
                label="買い"
              />
              <SegmentedButton
                active={side === "SELL"}
                activeClass="bg-loss text-white"
                onClick={() => setSide("SELL")}
                label="売り"
              />
            </div>

            <label className="block text-sm">
              <span className="text-neutral-500">注文種別</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as OrderType)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="MARKET">成行 (MARKET)</option>
                <option value="LIMIT">指値 (LIMIT)</option>
                <option value="STOP">逆指値 (STOP)</option>
                <option value="STOP_LIMIT">逆指値リミット (STOP_LIMIT)</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-neutral-500">数量</span>
              <input
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={`${instrument.lotSize} 株単位`}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
              />
            </label>

            {needsLimit && (
              <PriceInput
                label="指値価格"
                value={limitPrice}
                onChange={setLimitPrice}
              />
            )}
            {needsStop && (
              <PriceInput
                label="逆指値価格"
                value={stopPrice}
                onChange={setStopPrice}
              />
            )}

            <label className="block text-sm">
              <span className="text-neutral-500">有効期限</span>
              <select
                value={timeInForce}
                onChange={(e) => setTimeInForce(e.target.value as TimeInForce)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="DAY">当日 (DAY)</option>
                <option value="GTC">無期限 (GTC)</option>
              </select>
            </label>

            {localError && <ErrorState message={localError} />}
            {submitError && <ErrorState message={submitError} />}
            {placed && (
              <p className="rounded-md border border-gain/30 bg-gain/5 px-3 py-2 text-sm text-gain">
                注文を受け付けました（ID: {placed}）。
              </p>
            )}

            <Button
              type="submit"
              variant={side === "BUY" ? "primary" : "danger"}
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending
                ? "送信中…"
                : `${side === "BUY" ? "買い" : "売り"}注文を出す`}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SegmentedButton({
  active,
  activeClass,
  onClick,
  label,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? activeClass : "bg-neutral-100 text-neutral-600",
      )}
    >
      {label}
    </button>
  );
}

function PriceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例: 1234.5"
        className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}
