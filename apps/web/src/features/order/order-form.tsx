"use client";

import { useState, type FormEvent } from "react";
import type {
  Currency,
  Instrument,
  MarginRequirement,
  MarginType,
  OrderSide,
  OrderType,
  PlaceOrderCommand,
  TimeInForce,
} from "@stonks/contracts";
import {
  useMarginRequirement,
  usePlaceOrder,
  useQuote,
} from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatMoney, formatRatePercent } from "@/lib/format";
import { isMarginEligible } from "@/lib/margin-eligibility";

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
  const [marginType, setMarginType] = useState<MarginType>("CASH");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("DAY");
  const [localError, setLocalError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const mutation = usePlaceOrder(accountId);

  const needsLimit = type === "LIMIT" || type === "STOP_LIMIT";
  const needsStop = type === "STOP" || type === "STOP_LIMIT";

  const isMargin = marginType === "MARGIN";

  // 銘柄マスタ由来の信用建て可否（純粋判定。undefined=不明は抑止しない）。
  const eligible = isMarginEligible(instrument, side);
  const marginBlocked = isMargin && eligible === false;

  // 保証金プレビューに使う価格: 指値系は入力値、成行は最新気配の last。
  // 既存の useQuote を再利用する（MARGIN かつ成行のときだけ取得すれば十分だが、
  // 価格未確定でも quote 取得自体は QuotePanel と同キャッシュを共有するため無害）。
  const quoteQuery = useQuote(isMargin ? instrument?.id : undefined);
  const qtyNum = Number(quantity);
  const hasValidQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const previewPrice = needsLimit
    ? DECIMAL_RE.test(limitPrice)
      ? limitPrice
      : undefined
    : quoteQuery.data?.last;
  // 成行は価格を api の最新値に委ねたい（previewPrice=undefined のとき api が補完）が、
  // ここでは取得済みの quote があればそれを送り、無ければ undefined で api 任せにする。
  const previewEnabled = isMargin && !marginBlocked && hasValidQty;
  const marginQuery = useMarginRequirement(
    instrument?.id,
    {
      side,
      quantity: hasValidQty ? qtyNum : 0,
      price: previewPrice,
      marginType: "MARGIN",
    },
    previewEnabled,
  );

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

    if (marginBlocked) {
      setLocalError(
        side === "BUY"
          ? "この銘柄は信用買い建てができません（現物を選択してください）。"
          : "この銘柄は信用売り建て（空売り）ができません。",
      );
      return;
    }

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
      // 資金区分は MARGIN のときだけ付与する。CASH（既定）は従来どおり省略し、
      // 現物フローと完全に後方互換にする（api/engine は未指定を CASH と解釈）。
      ...(marginType === "MARGIN" ? { marginType: "MARGIN" as const } : {}),
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

            <div className="block text-sm">
              <span className="text-neutral-500">資金区分</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <SegmentedButton
                  active={marginType === "CASH"}
                  activeClass="bg-neutral-800 text-white"
                  onClick={() => setMarginType("CASH")}
                  label="現物 (CASH)"
                />
                <SegmentedButton
                  active={marginType === "MARGIN"}
                  activeClass="bg-neutral-800 text-white"
                  onClick={() => setMarginType("MARGIN")}
                  label="信用 (MARGIN)"
                  disabled={eligible === false}
                  title={
                    eligible === false
                      ? side === "BUY"
                        ? "この銘柄は信用買い建てができません。"
                        : "この銘柄は信用売り建て（空売り）ができません。"
                      : undefined
                  }
                />
              </div>
            </div>

            {isMargin && (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                {side === "BUY"
                  ? "信用買い建て（ロング建玉）として発注します。"
                  : "信用売り建て（空売り／ショート建玉）として発注します。"}
                <br />
                信用取引はシミュレーション上の建玉です（保証金・金利／貸株料も模擬計算）。
                投資助言ではありません。
              </p>
            )}

            {isMargin && marginBlocked && (
              <ErrorState
                message={
                  side === "BUY"
                    ? "この銘柄は制度上、信用買い建てができません。現物 (CASH) を選択してください。"
                    : "この銘柄は制度上、信用売り建て（空売り）ができません。"
                }
              />
            )}

            {isMargin && !marginBlocked && (
              <MarginPreview
                currency={instrument.currency}
                requirement={marginQuery.data ?? null}
                isLoading={previewEnabled && marginQuery.isLoading}
                isError={previewEnabled && marginQuery.isError}
                hasInput={hasValidQty}
              />
            )}

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
              disabled={mutation.isPending || marginBlocked}
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
  disabled = false,
  title,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string | undefined;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? activeClass : "bg-neutral-100 text-neutral-600",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {label}
    </button>
  );
}

/**
 * 信用建ての必要保証金プレビュー（概算）。値は DecimalString のまま受け取り
 * 表示整形のみ行う（CLAUDE.md §0）。捏造値を出さないため、未確定/ロード中/取得失敗は
 * 「—」やメッセージで縮退する。投資助言ではない旨の免責を添える（CLAUDE.md §7）。
 */
function MarginPreview({
  currency,
  requirement,
  isLoading,
  isError,
  hasInput,
}: {
  currency: Currency;
  requirement: MarginRequirement | null;
  isLoading: boolean;
  isError: boolean;
  hasInput: boolean;
}): JSX.Element {
  const body = !hasInput ? (
    <p className="text-xs text-neutral-400">
      数量を入力すると必要保証金（概算）を表示します。
    </p>
  ) : isError ? (
    <p className="text-xs text-neutral-500">
      この条件では保証金プレビューを取得できません（信用不可の可能性があります）。
    </p>
  ) : isLoading || !requirement ? (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <PreviewField label="総代金" value="—" />
      <PreviewField label="必要保証金" value="—" />
      <PreviewField label="保証金率" value="—" />
    </dl>
  ) : (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <PreviewField
        label="総代金"
        value={formatMoney(requirement.notional, requirement.currency)}
      />
      <PreviewField
        label="必要保証金"
        value={formatMoney(requirement.requiredMargin, requirement.currency)}
      />
      <PreviewField
        label="保証金率"
        value={formatRatePercent(requirement.initialMarginRate)}
      />
    </dl>
  );

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-500">
          保証金プレビュー（概算 / {currency}）
        </span>
      </div>
      {body}
      <p className="text-[11px] leading-snug text-neutral-400">
        必要保証金は最新気配または指値に基づく概算で、実際の約定価格・手数料により変動します。
        シミュレーションであり投資助言ではありません。
      </p>
    </div>
  );
}

function PreviewField({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-md bg-neutral-50 px-2 py-1.5">
      <dt className="text-[11px] text-neutral-400">{label}</dt>
      <dd className="tabular-nums font-medium text-neutral-800">{value}</dd>
    </div>
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
