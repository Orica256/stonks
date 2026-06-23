import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Instrument } from "@stonks/contracts";
import { OrderForm } from "./order-form";

/**
 * 単発発注フォームの描画/操作テスト。
 * hooks（サーバ状態）はモックし、ペイロード組み立て（資金区分の省略/付与）と
 * 数量/価格バリデーションを検証する。
 */

const place = vi.fn();

const hookState = {
  place: {
    mutate: place,
    error: null as Error | null,
    isPending: false,
  },
};

vi.mock("@/lib/api/hooks", () => ({
  usePlaceOrder: () => hookState.place,
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
  hookState.place = { mutate: place, error: null, isPending: false };
});

describe("OrderForm", () => {
  it("銘柄未選択ならプレースホルダを表示する", () => {
    render(<OrderForm accountId="acc-1" instrument={null} />);
    expect(
      screen.getByText("銘柄を選択すると発注できます。"),
    ).toBeInTheDocument();
  });

  it("既定（CASH）では送信コマンドに marginType を含めない", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);

    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "買い注文を出す" }));

    expect(place).toHaveBeenCalledTimes(1);
    const command = place.mock.calls[0]![0];
    expect(command).not.toHaveProperty("marginType");
    expect(command).not.toHaveProperty("accountId");
    expect(command).toMatchObject({
      instrumentId: "TSE:7203",
      side: "BUY",
      type: "MARKET",
      quantity: 100,
    });
  });

  it("信用 (MARGIN) を選ぶと marginType:\"MARGIN\" を付与して送信する", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);

    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "信用 (MARGIN)" }));
    fireEvent.click(screen.getByRole("button", { name: "買い注文を出す" }));

    expect(place).toHaveBeenCalledTimes(1);
    const command = place.mock.calls[0]![0];
    expect(command.marginType).toBe("MARGIN");
  });

  it("MARGIN 選択時に免責（シミュレーション上の建玉）を表示する", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);
    // 既定 CASH では免責は出ない。
    expect(
      screen.queryByText(/シミュレーション上の建玉/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "信用 (MARGIN)" }));
    expect(
      screen.getByText(/シミュレーション上の建玉/),
    ).toBeInTheDocument();
  });

  it("数量が不正なときはローカルエラーを出し mutate しない", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);

    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "買い注文を出す" }));

    expect(place).not.toHaveBeenCalled();
    expect(
      screen.getByText("数量は 1 以上の数値を入力してください。"),
    ).toBeInTheDocument();
  });

  it("指値で価格未入力ならローカルエラーを出し mutate しない", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);

    // 注文種別 select を LIMIT に切替（最初の combobox）。
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "LIMIT" } });

    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "買い注文を出す" }));

    expect(place).not.toHaveBeenCalled();
    expect(
      screen.getByText("指値価格を正しく入力してください。"),
    ).toBeInTheDocument();
  });

  it("LIMIT で価格を入れると marginType 省略・limitPrice 付きで送信する", () => {
    render(<OrderForm accountId="acc-1" instrument={instrument} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "LIMIT" } });

    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("例: 1234.5"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "買い注文を出す" }));

    expect(place).toHaveBeenCalledTimes(1);
    const command = place.mock.calls[0]![0];
    expect(command).not.toHaveProperty("marginType");
    expect(command).toMatchObject({ type: "LIMIT", limitPrice: "1500" });
  });
});
