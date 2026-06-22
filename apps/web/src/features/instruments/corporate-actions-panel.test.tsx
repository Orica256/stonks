import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CorporateAction, Instrument } from "@stonks/contracts";
import { CorporateActionsPanel } from "./corporate-actions-panel";

/**
 * 配当・分割パネルの描画/操作テスト。
 * hooks（サーバ状態）はモックし、一覧描画と「口座に反映」操作のみを検証する。
 */

const mutate = vi.fn();

const hookState = {
  query: {
    data: undefined as CorporateAction[] | undefined,
    isLoading: false,
    isError: false,
  },
  mutation: { mutate, error: null as Error | null, isPending: false },
};

vi.mock("@/lib/api/hooks", () => ({
  useCorporateActions: () => hookState.query,
  useApplyCorporateAction: () => hookState.mutation,
}));

const instrument: Instrument = {
  id: "TSE:7203",
  symbol: "7203",
  exchange: "TSE",
  market: "JP",
  name: "トヨタ自動車",
  currency: "JPY",
  type: "STOCK",
  lotSize: 100,
  tickRules: [],
  isActive: true,
};

const actions: CorporateAction[] = [
  {
    instrumentId: "TSE:7203",
    type: "DIVIDEND",
    exDate: "2026-03-30T00:00:00.000Z",
    value: "75",
  },
  {
    instrumentId: "TSE:7203",
    type: "SPLIT",
    exDate: "2026-04-01T00:00:00.000Z",
    value: "2",
  },
];

afterEach(() => {
  cleanup();
  mutate.mockReset();
  hookState.query = { data: undefined, isLoading: false, isError: false };
  hookState.mutation = { mutate, error: null, isPending: false };
});

describe("CorporateActionsPanel", () => {
  it("銘柄未選択ならプレースホルダを表示する", () => {
    render(<CorporateActionsPanel accountId="acc-1" instrument={null} />);
    expect(
      screen.getByText("銘柄を選択すると配当・分割を表示します。"),
    ).toBeInTheDocument();
  });

  it("配当・分割を一覧表示する（種別ラベル/値）", () => {
    hookState.query = { data: actions, isLoading: false, isError: false };
    render(
      <CorporateActionsPanel accountId="acc-1" instrument={instrument} />,
    );
    expect(screen.getByText("配当")).toBeInTheDocument();
    expect(screen.getByText("分割")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
  });

  it("「口座に反映」で applyCorporateAction を当該アクションで呼ぶ", () => {
    hookState.query = { data: actions, isLoading: false, isError: false };
    render(
      <CorporateActionsPanel accountId="acc-1" instrument={instrument} />,
    );
    const buttons = screen.getAllByRole("button", { name: "口座に反映" });
    fireEvent.click(buttons[0]!);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual(actions[0]);
  });

  it("対象がなければ空状態を表示する", () => {
    hookState.query = { data: [], isLoading: false, isError: false };
    render(
      <CorporateActionsPanel accountId="acc-1" instrument={instrument} />,
    );
    expect(
      screen.getByText("対象期間の配当・分割はありません。"),
    ).toBeInTheDocument();
  });
});
