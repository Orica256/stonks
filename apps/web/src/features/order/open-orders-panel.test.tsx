import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Order } from "@stonks/contracts";
import { OpenOrdersPanel } from "./open-orders-panel";

/**
 * オープン注文パネルの描画/操作テスト。
 * hooks（サーバ状態）はモックし、オープン絞り込み・バッジ・グルーピング・取消発火を検証する。
 */

const cancelOrder = vi.fn();
const cancelGroup = vi.fn();

const hookState = {
  query: {
    data: undefined as Order[] | undefined,
    isLoading: false,
    isError: false,
  },
  cancelOrder: { mutate: cancelOrder, error: null as Error | null, isPending: false },
  cancelGroup: { mutate: cancelGroup, error: null as Error | null, isPending: false },
};

vi.mock("@/lib/api/hooks", () => ({
  useOrders: () => hookState.query,
  useCancelOrder: () => hookState.cancelOrder,
  useCancelOrderGroup: () => hookState.cancelGroup,
}));

function order(partial: Partial<Order> & Pick<Order, "id">): Order {
  return {
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    side: "SELL",
    type: "LIMIT",
    quantity: 100,
    filledQuantity: 0,
    timeInForce: "DAY",
    status: "PENDING",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  cancelOrder.mockReset();
  cancelGroup.mockReset();
  hookState.query = { data: undefined, isLoading: false, isError: false };
  hookState.cancelOrder = { mutate: cancelOrder, error: null, isPending: false };
  hookState.cancelGroup = { mutate: cancelGroup, error: null, isPending: false };
});

describe("OpenOrdersPanel", () => {
  it("ローディング中はプレースホルダを表示する", () => {
    hookState.query = { data: undefined, isLoading: true, isError: false };
    render(<OpenOrdersPanel accountId="acc-1" />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("エラー時はエラー表示する", () => {
    hookState.query = { data: undefined, isLoading: false, isError: true };
    render(<OpenOrdersPanel accountId="acc-1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("オープン注文が無ければ空表示する（約定済のみ）", () => {
    hookState.query = {
      data: [order({ id: "done", status: "FILLED" })],
      isLoading: false,
      isError: false,
    };
    render(<OpenOrdersPanel accountId="acc-1" />);
    expect(
      screen.getByText("未約定・待機中の注文はありません。"),
    ).toBeInTheDocument();
  });

  it("オープンのみ絞り込み、status/activation バッジを描画する", () => {
    hookState.query = {
      data: [
        order({ id: "open", status: "PENDING", activation: "ACTIVE" }),
        order({ id: "done", status: "FILLED" }),
      ],
      isLoading: false,
      isError: false,
    };
    render(<OpenOrdersPanel accountId="acc-1" />);

    expect(screen.getByText("未約定")).toBeInTheDocument();
    expect(screen.getByText("有効")).toBeInTheDocument();
    // 約定済の行は出ない。
    expect(screen.queryByText("約定済")).not.toBeInTheDocument();
  });

  it("複合注文（OCO）を束ねて linkType バッジとグループ取消を出す", () => {
    hookState.query = {
      data: [
        order({ id: "oco-1", linkGroupId: "g1", linkType: "OCO" }),
        order({ id: "oco-2", linkGroupId: "g1", linkType: "OCO" }),
      ],
      isLoading: false,
      isError: false,
    };
    render(<OpenOrdersPanel accountId="acc-1" />);

    expect(screen.getByText("複合注文（2 件）")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "グループを一括取消" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "グループを一括取消" }),
    );
    expect(cancelGroup).toHaveBeenCalledWith("g1");
  });

  it("単発取消ボタンで注文 id を渡して取消を呼ぶ", () => {
    hookState.query = {
      data: [order({ id: "ord-9", status: "PENDING" })],
      isLoading: false,
      isError: false,
    };
    render(<OpenOrdersPanel accountId="acc-1" />);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(cancelOrder).toHaveBeenCalledWith("ord-9");
  });

  it("IFD 子に WAITING バッジを表示する", () => {
    hookState.query = {
      data: [
        order({ id: "parent", side: "BUY", type: "MARKET", linkType: "IFD" }),
        order({
          id: "child",
          parentOrderId: "parent",
          activation: "WAITING",
        }),
      ],
      isLoading: false,
      isError: false,
    };
    render(<OpenOrdersPanel accountId="acc-1" />);

    expect(screen.getByText("待機（親約定待ち）")).toBeInTheDocument();
    expect(screen.getByText("子")).toBeInTheDocument();
  });
});
