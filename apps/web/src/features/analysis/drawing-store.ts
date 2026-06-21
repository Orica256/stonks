import { create } from "zustand";
import type { Instrument } from "@stonks/contracts";
import {
  applyClick,
  createIdGenerator,
  removeDrawing,
  type Drawing,
  type DrawMode,
  type LinePoint,
  type PendingTrendline,
} from "./lib/drawing";

/**
 * 描画ツール（spec §2.4 P2）の UI 状態を Zustand で保持する（CLAUDE.md §3: UI 状態は Zustand）。
 * 作図はクライアント完結。バーデータ（サーバ状態）は TanStack Query 側に置く。
 */

/** 作図上限（暴走防止・描画負荷の抑制）。 */
export const MAX_DRAWINGS = 50;

const nextId = createIdGenerator("draw");

interface DrawingState {
  /** 作図対象の単一銘柄（未選択は undefined）。 */
  instrument: Instrument | undefined;
  /** 現在の作図モード。 */
  mode: DrawMode;
  /** 確定済みの作図一覧。 */
  drawings: Drawing[];
  /** トレンドライン作図中の暫定 1 点目（なければ undefined）。 */
  pending: PendingTrendline | undefined;

  /** 対象銘柄を切り替える。銘柄が変わると作図はクリアする。 */
  setInstrument: (instrument: Instrument | undefined) => void;
  /** モードを設定する（切替時は作図中の pending を破棄）。 */
  setMode: (mode: DrawMode) => void;
  /** チャートクリックを現在モードへ反映する（追加・pending 更新）。 */
  handleClick: (point: LinePoint) => void;
  /** 作図中の暫定 1 点目を取り消す。 */
  cancelPending: () => void;
  /** 指定 id の作図を削除する。 */
  remove: (id: string) => void;
  /** すべての作図を消す。 */
  clear: () => void;
}

export const useDrawingStore = create<DrawingState>((set) => ({
  instrument: undefined,
  mode: "none",
  drawings: [],
  pending: undefined,

  setInstrument: (instrument) =>
    set({ instrument, drawings: [], pending: undefined }),

  setMode: (mode) => set({ mode, pending: undefined }),

  handleClick: (point) =>
    set((s) => {
      if (s.mode === "none") return s;
      const res = applyClick(s.mode, point, s.pending, nextId);
      if (res.added) {
        if (s.drawings.length >= MAX_DRAWINGS) {
          // 上限超過は無視（pending だけ解消）。
          return { pending: res.pending };
        }
        return {
          drawings: [...s.drawings, res.added],
          pending: res.pending,
        };
      }
      return { pending: res.pending };
    }),

  cancelPending: () => set({ pending: undefined }),

  remove: (id) =>
    set((s) => ({ drawings: removeDrawing(s.drawings, id) })),

  clear: () => set({ drawings: [], pending: undefined }),
}));
