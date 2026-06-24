import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Instrument, Trade } from "@stonks/contracts";
import HistoryPage from "./page";

/**
 * 取引履歴画面の描画テスト。
 * hooks（サーバ状態）はモックし、銘柄解決（取引所バッジ＋symbol＋名）と
 * 金額の通貨整形・未解決時の縮退（捏造しない）を OpenOrdersPanel と同じ流儀で検証する。
 */

const hookState = {
  trades: {
    data: undefined as Trade[] | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  // instrumentId → Instrument の解決結果（既定は未解決＝フォールバック経路）。
  instrumentMap: new Map<string, Instrument>(),
};

vi.mock("@/lib/api/hooks", () => ({
  useTrades: () => hookState.trades,
  useInstrumentMap: () => hookState.instrumentMap,
}));

vi.mock("@/lib/env", () => ({
  DEFAULT_ACCOUNT_ID: "acc-1",
}));

function instrument(
  partial: Partial<Instrument> & Pick<Instrument, "id">,
): Instrument {
  return {
    symbol: "7203",
    exchange: "TSE",
    market: "JP",
    name: "トヨタ自動車",
    currency: "JPY",
    type: "STOCK",
    lotSize: 100,
    tickRules: [],
    isActive: true,
    ...partial,
  };
}

function trade(partial: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    orderId: "ord-1",
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    side: "BUY",
    quantity: 100,
    price: "2500",
    fee: "275",
    currency: "JPY",
    executedAt: "2026-06-23T00:00:00.000Z",
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  hookState.trades = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  };
  hookState.instrumentMap = new Map<string, Instrument>();
});

describe("HistoryPage", () => {
  it("ローディング中はプレースホルダを表示する", () => {
    hookState.trades = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    render(<HistoryPage />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("エラー時はエラー表示する", () => {
    hookState.trades = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("boom"),
    };
    render(<HistoryPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("約定が無ければ空表示する", () => {
    hookState.trades = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<HistoryPage />);
    expect(screen.getByText("約定はまだありません。")).toBeInTheDocument();
  });

  it("Instrument 解決済みなら symbol・銘柄名・取引所バッジ・通貨整形を表示する", () => {
    hookState.trades = {
      data: [trade({ id: "t-jpy", instrumentId: "TSE:7203", price: "2500", fee: "275" })],
      isLoading: false,
      isError: false,
      error: null,
    };
    hookState.instrumentMap = new Map([
      ["TSE:7203", instrument({ id: "TSE:7203" })],
    ]);
    render(<HistoryPage />);

    expect(screen.getByText("7203")).toBeInTheDocument();
    expect(screen.getByText("（トヨタ自動車）")).toBeInTheDocument();
    expect(screen.getByText("TSE")).toBeInTheDocument();
    // JPY 整形（円記号付き・小数なし。字形差は許容）。
    expect(screen.getByText(/[¥￥]2,500/)).toBeInTheDocument();
    expect(screen.getByText(/[¥￥]275/)).toBeInTheDocument();
  });

  it("未解決でも parseInstrumentId フォールバックで symbol・取引所・通貨を導出する", () => {
    hookState.trades = {
      data: [
        trade({
          id: "t-usd",
          instrumentId: "NASDAQ:AAPL",
          price: "190.5",
          fee: "1",
          currency: "USD",
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
    // instrumentMap は空（404/ローディング相当）。
    render(<HistoryPage />);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("NASDAQ")).toBeInTheDocument();
    // 銘柄名は捏造しない（名前の括弧表記は出ない）。
    expect(screen.queryByText(/（.+）/)).not.toBeInTheDocument();
    // NASDAQ→USD 導出で $ 整形（小数 2 桁）。
    expect(screen.getByText(/\$190\.50/)).toBeInTheDocument();
  });

  it("instrumentId が不正形式なら生文字列を表示し金額は Trade 通貨で整形する", () => {
    hookState.trades = {
      data: [
        trade({
          id: "t-bad",
          instrumentId: "not-an-id",
          price: "100",
          fee: "0",
          currency: "USD",
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<HistoryPage />);

    expect(screen.getByText("not-an-id")).toBeInTheDocument();
    // display.currency は undefined → Trade 自身の USD にフォールバックして整形。
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });
});
