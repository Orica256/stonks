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

interface QueryLike {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}

const hookState = {
  place: {
    mutate: place,
    error: null as Error | null,
    isPending: false,
  },
  quote: { data: undefined, isLoading: false, isError: false } as QueryLike,
  margin: { data: undefined, isLoading: false, isError: false } as QueryLike,
};

vi.mock("@/lib/api/hooks", () => ({
  usePlaceOrder: () => hookState.place,
  useQuote: () => hookState.quote,
  useMarginRequirement: () => hookState.margin,
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
  hookState.quote = { data: undefined, isLoading: false, isError: false };
  hookState.margin = { data: undefined, isLoading: false, isError: false };
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

  it("MARGIN かつ数量入力で必要保証金プレビューを表示する", () => {
    hookState.margin = {
      data: {
        notional: "1500000",
        requiredMargin: "450000",
        initialMarginRate: "0.3",
        currency: "JPY",
      },
      isLoading: false,
      isError: false,
    };

    render(<OrderForm accountId="acc-1" instrument={instrument} />);
    fireEvent.click(screen.getByRole("button", { name: "信用 (MARGIN)" }));
    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });

    expect(screen.getByText("必要保証金")).toBeInTheDocument();
    // 概算金額（JPY 整形）と率（%表示）が出る。
    expect(screen.getByText("￥450,000")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("MARGIN プレビュー取得失敗（信用不可）は縮退メッセージを出す", () => {
    hookState.margin = { data: undefined, isLoading: false, isError: true };

    render(<OrderForm accountId="acc-1" instrument={instrument} />);
    fireEvent.click(screen.getByRole("button", { name: "信用 (MARGIN)" }));
    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });

    expect(
      screen.getByText(/保証金プレビューを取得できません/),
    ).toBeInTheDocument();
  });

  it("marginTradable=false の銘柄では BUY の MARGIN 選択を無効化する", () => {
    const noMargin: Instrument = { ...instrument, marginTradable: false };
    render(<OrderForm accountId="acc-1" instrument={noMargin} />);

    const marginButton = screen.getByRole("button", { name: "信用 (MARGIN)" });
    expect(marginButton).toBeDisabled();
  });

  it("shortMarginable=false の銘柄で SELL の MARGIN 選択時は発注を抑止する", () => {
    // marginTradable は不明、shortMarginable=false（売建不可）。
    const noShort: Instrument = { ...instrument, shortMarginable: false };
    render(<OrderForm accountId="acc-1" instrument={noShort} />);

    // 売りに切替（SELL は shortMarginable=false で抑止対象）。
    fireEvent.click(screen.getByRole("button", { name: "売り" }));
    // BUY 不明なので MARGIN ボタンは押せる（side=SELL に切替後は disabled になる）。
    const marginButton = screen.getByRole("button", { name: "信用 (MARGIN)" });
    expect(marginButton).toBeDisabled();
  });

  it("marginTradable=false で MARGIN を選んでいる状態（side 切替経由）は発注を抑止する", () => {
    // BUY は不明だが SELL は売建不可。BUY で MARGIN を選び、SELL に切替えると抑止される。
    const noShort: Instrument = { ...instrument, shortMarginable: false };
    render(<OrderForm accountId="acc-1" instrument={noShort} />);

    fireEvent.click(screen.getByRole("button", { name: "信用 (MARGIN)" }));
    fireEvent.click(screen.getByRole("button", { name: "売り" }));
    fireEvent.change(screen.getByPlaceholderText("100 株単位"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "売り注文を出す" }));

    expect(place).not.toHaveBeenCalled();
    expect(
      screen.getByText(/信用売り建て（空売り）ができません/),
    ).toBeInTheDocument();
  });
});
