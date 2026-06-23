import type {
  OrderActivation,
  OrderSide,
  OrderType,
  PlaceBracketOrderCommand,
  PlaceOrderCommand,
  TimeInForce,
} from "@stonks/contracts";

/**
 * 複合注文（OCO / IFD / BRACKET）フォームの純粋ロジック（spec §2.2 P2 / Phase 5）。
 *
 * UI（bracket-order-form.tsx）から分離し Vitest 対象にする。価格は浮動小数で扱わず
 * DecimalString（文字列）のまま組み立てる（CLAUDE.md §0）。投資助言は含まない（§7）。
 */

/** 複合注文の種別。contracts の PlaceBracketOrderCommand["kind"] に一致。 */
export type BracketKind = "OCO" | "IFD" | "BRACKET";

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** 1 脚（leg / parent / child）の入力状態。価格は文字列のまま保持する。 */
export interface LegInput {
  side: OrderSide;
  type: OrderType;
  quantity: string;
  limitPrice: string;
  stopPrice: string;
}

/** 既定の脚入力（成行・買い）。 */
export function emptyLeg(side: OrderSide = "BUY"): LegInput {
  return { side, type: "MARKET", quantity: "", limitPrice: "", stopPrice: "" };
}

/** 脚の注文種別が指値/逆指値を必要とするか。 */
export function needsLimit(type: OrderType): boolean {
  return type === "LIMIT" || type === "STOP_LIMIT";
}
export function needsStop(type: OrderType): boolean {
  return type === "STOP" || type === "STOP_LIMIT";
}

/** 単一脚の検証結果（成功時は PlaceOrderCommand 入力形、失敗時はエラー文言）。 */
type LegResult =
  | { ok: true; leg: BracketLeg }
  | { ok: false; error: string };

/**
 * leg/parent/child として送る PlaceOrderCommand 入力形（accountId はパス注入のため除く）。
 * instrumentId / timeInForce はフォーム共通値を呼び出し側が補う。
 */
export type BracketLeg = Omit<PlaceOrderCommand, "accountId">;

function buildLeg(
  input: LegInput,
  instrumentId: string,
  timeInForce: TimeInForce,
  label: string,
): LegResult {
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: `${label}: 数量は 1 以上の数値を入力してください。` };
  }
  if (needsLimit(input.type) && !DECIMAL_RE.test(input.limitPrice)) {
    return { ok: false, error: `${label}: 指値価格を正しく入力してください。` };
  }
  if (needsStop(input.type) && !DECIMAL_RE.test(input.stopPrice)) {
    return { ok: false, error: `${label}: 逆指値価格を正しく入力してください。` };
  }
  const leg: BracketLeg = {
    instrumentId,
    side: input.side,
    type: input.type,
    quantity: qty,
    timeInForce,
    ...(needsLimit(input.type) ? { limitPrice: input.limitPrice } : {}),
    ...(needsStop(input.type) ? { stopPrice: input.stopPrice } : {}),
  };
  return { ok: true, leg };
}

/** フォーム全体の入力状態（kind と脚群）。 */
export interface BracketFormState {
  kind: BracketKind;
  /** OCO: 2 脚。IFD/BRACKET: legs[0] を親、legs[1..] を子として使う。 */
  legs: LegInput[];
}

/** ビルド結果（成功時は送信用コマンド、失敗時は最初のエラー文言）。 */
export type BuildResult =
  | { ok: true; command: PlaceBracketOrderCommand }
  | { ok: false; error: string };

/**
 * フォーム状態から PlaceBracketOrderCommand を組み立てる（クライアント側の最低限検証込み）。
 * accountId は body に含めない（api がパス値で注入する）。
 */
export function buildBracketCommand(
  state: BracketFormState,
  instrumentId: string,
  timeInForce: TimeInForce,
): BuildResult {
  const { kind, legs } = state;

  if (kind === "OCO") {
    if (legs.length !== 2) {
      return { ok: false, error: "OCO は 2 脚を指定してください。" };
    }
    const a = buildLeg(legs[0]!, instrumentId, timeInForce, "脚 1");
    if (!a.ok) return a;
    const b = buildLeg(legs[1]!, instrumentId, timeInForce, "脚 2");
    if (!b.ok) return b;
    return { ok: true, command: { kind: "OCO", legs: [a.leg, b.leg] } };
  }

  // IFD / BRACKET は親 1 ＋ 子。
  if (legs.length < 2) {
    return { ok: false, error: "親注文と子注文を入力してください。" };
  }
  const parent = buildLeg(legs[0]!, instrumentId, timeInForce, "親注文");
  if (!parent.ok) return parent;

  if (kind === "BRACKET") {
    if (legs.length !== 3) {
      return {
        ok: false,
        error: "BRACKET は親 1 ＋ 子 2（利確・損切）を指定してください。",
      };
    }
    const tp = buildLeg(legs[1]!, instrumentId, timeInForce, "子注文（利確）");
    if (!tp.ok) return tp;
    const sl = buildLeg(legs[2]!, instrumentId, timeInForce, "子注文（損切）");
    if (!sl.ok) return sl;
    return {
      ok: true,
      command: { kind: "BRACKET", parent: parent.leg, children: [tp.leg, sl.leg] },
    };
  }

  // IFD: 子 1 本以上。
  const children: BracketLeg[] = [];
  for (let i = 1; i < legs.length; i += 1) {
    const c = buildLeg(legs[i]!, instrumentId, timeInForce, `子注文 ${i}`);
    if (!c.ok) return c;
    children.push(c.leg);
  }
  if (children.length < 1) {
    return { ok: false, error: "IFD は子注文を 1 本以上入力してください。" };
  }
  return { ok: true, command: { kind: "IFD", parent: parent.leg, children } };
}

/** 発効状態の日本語ラベル（未指定/ACTIVE は「有効」）。 */
export function activationLabel(activation: OrderActivation | undefined): string {
  return activation === "WAITING" ? "待機（親約定待ち）" : "有効";
}

/** リンク種別の日本語ラベル。 */
export function linkTypeLabel(linkType: "OCO" | "IFD" | undefined): string {
  if (linkType === "OCO") return "OCO";
  if (linkType === "IFD") return "IFD";
  return "単発";
}
