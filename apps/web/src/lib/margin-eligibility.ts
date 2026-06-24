import type { Instrument, OrderSide } from "@stonks/contracts";

/**
 * 銘柄マスタ由来の信用建て可否（spec §5.1 / Instrument.marginTradable・shortMarginable）。
 *
 * 純粋な判定関数（副作用なし）。web の事前抑止 UI と単体テストから使う。
 * 金額や率は扱わない（保証金額の概算は api の margin-requirement が正準）。
 *
 * 戻り値:
 * - `true`      : 制度上、信用建てが可能（BUY=買建 / SELL=売建）。
 * - `false`     : 制度上、信用建てが不可（事前に MARGIN 選択を抑止する）。
 * - `undefined` : 不明（銘柄マスタにフラグが無い）。抑止せず api 側の最終判定に委ねる。
 *
 * 注意: ここで判定するのは「銘柄そのものの貸借区分上の可否」であり、
 * ポリシー設定上の可否（api の MarginPolicyProvider）とは別レイヤ。最終判定は api。
 */
export function isMarginEligible(
  instrument: Instrument | null | undefined,
  side: OrderSide,
): boolean | undefined {
  if (!instrument) return undefined;
  const flag =
    side === "BUY" ? instrument.marginTradable : instrument.shortMarginable;
  // undefined（不明）はそのまま undefined を返し、呼び出し側で抑止しない。
  return flag;
}
