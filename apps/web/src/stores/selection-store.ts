import { create } from "zustand";
import type { Instrument } from "@stonks/contracts";

/**
 * UI 状態（選択中の銘柄）は Zustand で管理する（spec §3: UI 状態は Zustand）。
 * サーバ状態は TanStack Query に置き、ここには載せない。
 */
interface SelectionState {
  selected: Instrument | null;
  select: (instrument: Instrument | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: null,
  select: (instrument) => set({ selected: instrument }),
}));
