import { create } from "zustand";
import type { Instrument } from "@stonks/contracts";

/**
 * 分析画面の UI 状態（比較・ヒートマップ対象の銘柄群）を Zustand で保持する
 * （spec §3: UI 状態は Zustand）。サーバ状態（バー/気配）は TanStack Query 側に置く。
 */

/** 同時比較できる銘柄数の上限（描画/リクエストの暴走防止）。 */
export const MAX_INSTRUMENTS = 6;

interface AnalysisState {
  /** 選択中の銘柄（id 重複なし、追加順）。 */
  instruments: Instrument[];
  /** 既に選択済みなら無視。上限を超える場合も無視。 */
  add: (instrument: Instrument) => void;
  remove: (instrumentId: string) => void;
  clear: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  instruments: [],
  add: (instrument) =>
    set((s) => {
      if (s.instruments.length >= MAX_INSTRUMENTS) return s;
      if (s.instruments.some((i) => i.id === instrument.id)) return s;
      return { instruments: [...s.instruments, instrument] };
    }),
  remove: (instrumentId) =>
    set((s) => ({
      instruments: s.instruments.filter((i) => i.id !== instrumentId),
    })),
  clear: () => set({ instruments: [] }),
}));
