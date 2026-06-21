/**
 * 描画ツール（spec §2.4 P2「描画ツール」）の純粋ロジック。
 *
 * クライアント完結の簡易作図（水平線=価格ライン／トレンドライン=2点の線分）の
 * 状態管理・座標変換を、lightweight-charts 本体や canvas に依存しない純粋関数として切り出す。
 * 金額演算ではなくチャート座標の表示計算に閉じる（CLAUDE.md §0: 金額演算は core-domain 側）。
 */

/** トレンドラインの端点（time は UNIX 秒/UTC、price は表示用の数値）。 */
export interface LinePoint {
  /** UNIX 秒（UTC）。lightweight-charts の UTCTimestamp と互換。 */
  time: number;
  /** 価格（表示用の数値。金額演算には用いない）。 */
  price: number;
}

/** 水平線（特定価格の価格ライン）。 */
export interface HorizontalDrawing {
  id: string;
  kind: "horizontal";
  price: number;
}

/** トレンドライン（2 点を結ぶ線分）。 */
export interface TrendlineDrawing {
  id: string;
  kind: "trendline";
  a: LinePoint;
  b: LinePoint;
}

/** 1 つの作図要素。 */
export type Drawing = HorizontalDrawing | TrendlineDrawing;

/** 作図モード。`none` は選択/削除のみ、`horizontal`/`trendline` は追加モード。 */
export type DrawMode = "none" | "horizontal" | "trendline";

/**
 * 作図中（トレンドラインの 1 点目を置いた直後など）の暫定状態。
 * 2 点目のクリックで {@link TrendlineDrawing} へ確定する。
 */
export interface PendingTrendline {
  kind: "trendline";
  a: LinePoint;
}

/** クリック等で得られた 1 点を、現在モード下で作図状態へ反映した結果。 */
export interface ApplyResult {
  /** 追加が確定した作図（なければ undefined）。 */
  added: Drawing | undefined;
  /** 確定待ちの暫定状態（トレンドライン 1 点目を置いた直後など。なければ undefined）。 */
  pending: PendingTrendline | undefined;
}

/**
 * 作図モードとクリック点（と現在の pending）から次状態を計算する純粋関数。
 *
 * - `horizontal`: 即座に水平線を確定（price のみ使用）。
 * - `trendline`: 1 点目は pending に保持し、2 点目で線分を確定。
 * - `none`: 何もしない。
 *
 * id 採番は副作用なので外から与える（テスト容易性のため）。
 */
export function applyClick(
  mode: DrawMode,
  point: LinePoint,
  pending: PendingTrendline | undefined,
  nextId: () => string,
): ApplyResult {
  if (mode === "horizontal") {
    return {
      added: { id: nextId(), kind: "horizontal", price: point.price },
      pending: undefined,
    };
  }

  if (mode === "trendline") {
    if (!pending) {
      return { added: undefined, pending: { kind: "trendline", a: point } };
    }
    // 2 点目で確定。端点を time 昇順に正規化しておく（描画の安定化）。
    const [a, b] = orderByTime(pending.a, point);
    return {
      added: { id: nextId(), kind: "trendline", a, b },
      pending: undefined,
    };
  }

  return { added: undefined, pending: undefined };
}

/** 2 点を time 昇順に並べ替える（同時刻なら入力順を保つ）。 */
export function orderByTime(p: LinePoint, q: LinePoint): [LinePoint, LinePoint] {
  return p.time <= q.time ? [p, q] : [q, p];
}

/**
 * トレンドラインの 2 端点から、与えた time における線分上の price を線形補間する。
 * time が端点の外側でも直線を延長して返す（端点が同時刻なら a.price を返す）。
 */
export function priceAtTime(line: TrendlineDrawing, time: number): number {
  const { a, b } = line;
  const span = b.time - a.time;
  if (span === 0) return a.price;
  const t = (time - a.time) / span;
  return a.price + t * (b.price - a.price);
}

/** 作図リストから id 一致を除去する（純粋・新配列）。 */
export function removeDrawing(drawings: Drawing[], id: string): Drawing[] {
  return drawings.filter((d) => d.id !== id);
}

/**
 * lightweight-charts のクリックイベント由来の生値から {@link LinePoint} を組み立てる。
 * time/price のいずれかが欠落・非有限なら undefined（チャート範囲外クリック等）。
 */
export function toLinePoint(
  time: number | undefined,
  price: number | undefined,
): LinePoint | undefined {
  if (
    time === undefined ||
    price === undefined ||
    !Number.isFinite(time) ||
    !Number.isFinite(price)
  ) {
    return undefined;
  }
  return { time, price };
}

/** 連番 id 生成器を作る（プレフィックス + カウンタ）。副作用は閉じ込める。 */
export function createIdGenerator(prefix = "d"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** 作図要素の人間可読ラベル（一覧/削除 UI 用の表示整形）。 */
export function describeDrawing(d: Drawing): string {
  if (d.kind === "horizontal") {
    return `水平線 @ ${formatNum(d.price)}`;
  }
  return `トレンドライン ${formatNum(d.a.price)} → ${formatNum(d.b.price)}`;
}

/** 表示用の数値整形（最大 4 桁。金額演算ではなくラベル整形）。 */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(4)).toString();
}
