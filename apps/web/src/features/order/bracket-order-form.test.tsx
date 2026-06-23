import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Instrument, Order } from "@stonks/contracts";
import { BracketOrderForm } from "./bracket-order-form";

/**
 * 複合注文フォームの描画/操作テスト。
 * hooks（サーバ状態）はモックし、ペイロード組み立て・バリデーション・状態バッジ描画を検証する。
 */

const place = vi.fn();
const cancelGroup = vi.fn();

const hookState = {
  place: {
    mutate: place,
    error: null as Error | null,
    isPending: false,
  },
  cancel: {
    mutate: cancelGroup,
    error: null as Error | null,
    isPending: false,
  },
};

vi.mock("@/lib/api/hooks", () => ({
  usePlaceBracketOrder: () => hookState.place,
  useCancelOrderGroup: () => hookState.cancel,
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

afterEach(() => {
  cleanup();
  place.mockReset();
  cancelGroup.mockReset();
  hookState.place = { mutate: place, error: null, isPending: false };
  hookState.cancel = { mutate: cancelGroup, error: null, isPending: false };
});

describe("BracketOrderForm", () => {
  it("銘柄未選択ならプレースホルダを表示する", () => {
    render(<BracketOrderForm accountId="acc-1" instrument={null} />);
    expect(
      screen.getByText("銘柄を選択すると複合注文を発注できます。"),
    ).toBeInTheDocument();
  });

  it("数量未入力で送信するとローカルエラーを出し mutate しない", () => {
    render(<BracketOrderForm accountId="acc-1" instrument={instrument} />);
    fireEvent.click(screen.getByRole("button", { name: "OCO 注文を出す" }));
    expect(place).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("OCO の 2 脚を埋めると accountId 抜きの OCO コマンドで mutate する", () => {
    render(<BracketOrderForm accountId="acc-1" instrument={instrument} />);

    const qtyInputs = screen.getAllByPlaceholderText("100 株単位");
    fireEvent.change(qtyInputs[0]!, { target: { value: "100" } });
    fireEvent.change(qtyInputs[1]!, { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "OCO 注文を出す" }));

    expect(place).toHaveBeenCalledTimes(1);
    const command = place.mock.calls[0]![0];
    expect(command.kind).toBe("OCO");
    expect(command.legs).toHaveLength(2);
    expect(command.legs[0]).not.toHaveProperty("accountId");
    expect(command.legs[0]).toMatchObject({
      instrumentId: "TSE:7203",
      quantity: 100,
    });
  });

  it("発注後に発効状態（待機/有効）とリンク種別バッジを描画する", () => {
    const placed: Order[] = [
      {
        id: "p-1",
        accountId: "acc-1",
        instrumentId: "TSE:7203",
        side: "BUY",
        type: "MARKET",
        quantity: 100,
        filledQuantity: 0,
        timeInForce: "DAY",
        linkType: "IFD",
        activation: "ACTIVE",
        status: "PENDING",
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
      {
        id: "c-1",
        accountId: "acc-1",
        instrumentId: "TSE:7203",
        side: "SELL",
        type: "LIMIT",
        quantity: 100,
        filledQuantity: 0,
        limitPrice: "1500",
        timeInForce: "DAY",
        parentOrderId: "p-1",
        linkGroupId: "grp-1",
        linkType: "OCO",
        activation: "WAITING",
        status: "PENDING",
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    ];
    // mutate 呼び出し時に onSuccess(placed) を発火させる。
    place.mockImplementation(
      (_cmd: unknown, opts?: { onSuccess?: (o: Order[]) => void }) => {
        opts?.onSuccess?.(placed);
      },
    );

    render(<BracketOrderForm accountId="acc-1" instrument={instrument} />);

    // IFD を選び親＋子を埋める。
    fireEvent.click(screen.getByRole("button", { name: "IFD" }));
    const qtyInputs = screen.getAllByPlaceholderText("100 株単位");
    qtyInputs.forEach((el) => fireEvent.change(el, { target: { value: "100" } }));

    fireEvent.click(screen.getByRole("button", { name: "IFD 注文を出す" }));

    expect(screen.getByText("有効")).toBeInTheDocument();
    expect(screen.getByText("待機（親約定待ち）")).toBeInTheDocument();
    // 子注文に OCO リンク種別バッジ（span。kind 選択ボタンとは別要素）が出る。
    const ocoBadge = screen
      .getAllByText("OCO")
      .find((el) => el.tagName.toLowerCase() === "span");
    expect(ocoBadge).toBeDefined();
    // linkGroupId を持つのでグループ一括取消ボタンが出る。
    expect(
      screen.getByRole("button", { name: "グループを一括取消" }),
    ).toBeInTheDocument();
  });

  it("グループ一括取消ボタンで linkGroupId を渡して cancel を呼ぶ", () => {
    const placed: Order[] = [
      {
        id: "o-1",
        accountId: "acc-1",
        instrumentId: "TSE:7203",
        side: "SELL",
        type: "LIMIT",
        quantity: 100,
        filledQuantity: 0,
        limitPrice: "1500",
        timeInForce: "DAY",
        linkGroupId: "grp-9",
        linkType: "OCO",
        activation: "ACTIVE",
        status: "PENDING",
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
      {
        id: "o-2",
        accountId: "acc-1",
        instrumentId: "TSE:7203",
        side: "SELL",
        type: "STOP",
        quantity: 100,
        filledQuantity: 0,
        stopPrice: "1200",
        timeInForce: "DAY",
        linkGroupId: "grp-9",
        linkType: "OCO",
        activation: "ACTIVE",
        status: "PENDING",
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    ];
    place.mockImplementation(
      (_cmd: unknown, opts?: { onSuccess?: (o: Order[]) => void }) => {
        opts?.onSuccess?.(placed);
      },
    );

    render(<BracketOrderForm accountId="acc-1" instrument={instrument} />);
    const qtyInputs = screen.getAllByPlaceholderText("100 株単位");
    qtyInputs.forEach((el) => fireEvent.change(el, { target: { value: "100" } }));
    fireEvent.click(screen.getByRole("button", { name: "OCO 注文を出す" }));

    fireEvent.click(screen.getByRole("button", { name: "グループを一括取消" }));
    expect(cancelGroup).toHaveBeenCalledTimes(1);
    expect(cancelGroup.mock.calls[0]![0]).toBe("grp-9");
  });
});
