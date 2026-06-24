import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Instrument, TaxLot } from "@stonks/contracts";
import { TaxLotsPanel } from "./tax-lots-panel";

/**
 * 税ロット内訳パネルの描画テスト（Phase 8.1）。
 * hooks（サーバ状態）はモックし、ロット行に残数量・取得数量・取得単価・資金区分バッジ・
 * 銘柄が出ること、空/ロード/エラー、未決済トグルの open 連携を検証する。
 */

const useTaxLots = vi.fn();

const hookState = {
  taxLots: {
    data: undefined as TaxLot[] | undefined,
    isLoading: false,
    isError: false,
  },
  // instrumentId → Instrument の解決結果（既定は未解決＝フォールバック経路）。
  instrumentMap: new Map<string, Instrument>(),
};

vi.mock("@/lib/api/hooks", () => ({
  useTaxLots: (accountId: string, open?: boolean) => {
    useTaxLots(accountId, open);
    return hookState.taxLots;
  },
  useInstrumentMap: () => hookState.instrumentMap,
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

function lot(partial: Partial<TaxLot> & Pick<TaxLot, "id">): TaxLot {
  return {
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    quantity: 100,
    remainingQuantity: 100,
    costBasis: "2500",
    currency: "JPY",
    acquiredAt: "2026-06-23T00:00:00.000Z",
    method: "AVERAGE",
    taxAccountType: "SPECIFIC",
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  useTaxLots.mockReset();
  hookState.taxLots = { data: undefined, isLoading: false, isError: false };
  hookState.instrumentMap = new Map<string, Instrument>();
});

describe("TaxLotsPanel", () => {
  it("ローディング中はプレースホルダを表示する", () => {
    hookState.taxLots = { data: undefined, isLoading: true, isError: false };
    render(<TaxLotsPanel accountId="acc-1" />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("エラー時はエラー表示する", () => {
    hookState.taxLots = { data: undefined, isLoading: false, isError: true };
    render(<TaxLotsPanel accountId="acc-1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("ロットが無ければ空表示する", () => {
    hookState.taxLots = { data: [], isLoading: false, isError: false };
    render(<TaxLotsPanel accountId="acc-1" />);
    expect(screen.getByText("税ロットはありません。")).toBeInTheDocument();
  });

  it("ロット行に残数量・取得数量・取得単価・資金区分バッジ・銘柄を表示する", () => {
    hookState.taxLots = {
      data: [
        lot({
          id: "lot-margin",
          instrumentId: "TSE:7203",
          quantity: 200,
          remainingQuantity: 150,
          costBasis: "2500",
          marginType: "MARGIN",
        }),
      ],
      isLoading: false,
      isError: false,
    };
    hookState.instrumentMap = new Map([
      ["TSE:7203", instrument({ id: "TSE:7203" })],
    ]);
    render(<TaxLotsPanel accountId="acc-1" />);

    // 銘柄（取引所バッジ＋symbol＋銘柄名）。
    expect(screen.getByText("7203")).toBeInTheDocument();
    expect(screen.getByText("TSE")).toBeInTheDocument();
    expect(screen.getByText("（トヨタ自動車）")).toBeInTheDocument();
    // 残数量／取得数量。
    expect(screen.getByText("150／200")).toBeInTheDocument();
    // 取得単価（JPY 整形・円記号付き、字形差は許容）。
    expect(screen.getByText(/[¥￥]2,500/)).toBeInTheDocument();
    // 資金区分バッジ（MARGIN→信用）。
    expect(screen.getByText("信用")).toBeInTheDocument();
  });

  it("marginType 未指定は現物（CASH 既定）として表示する", () => {
    hookState.taxLots = {
      data: [lot({ id: "lot-cash" })],
      isLoading: false,
      isError: false,
    };
    render(<TaxLotsPanel accountId="acc-1" />);
    expect(screen.getByText("現物")).toBeInTheDocument();
  });

  it("未解決でも parseInstrumentId フォールバックで symbol・取引所を導出する", () => {
    hookState.taxLots = {
      data: [
        lot({
          id: "lot-usd",
          instrumentId: "NASDAQ:AAPL",
          currency: "USD",
          costBasis: "190.5",
        }),
      ],
      isLoading: false,
      isError: false,
    };
    // instrumentMap は空（404/ローディング相当）。
    render(<TaxLotsPanel accountId="acc-1" />);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("NASDAQ")).toBeInTheDocument();
    // 銘柄名は捏造しない（解決済み Instrument が無いので名前は出ない）。
    expect(screen.queryByText("（トヨタ自動車）")).not.toBeInTheDocument();
    // NASDAQ→USD 導出で $ 整形（小数 2 桁）。
    expect(screen.getByText(/\$190\.50/)).toBeInTheDocument();
  });

  it("未決済のみトグルで useTaxLots に open=true を渡す", () => {
    hookState.taxLots = {
      data: [lot({ id: "lot-1" })],
      isLoading: false,
      isError: false,
    };
    render(<TaxLotsPanel accountId="acc-1" />);

    // 初期は全件（open=false）。
    expect(useTaxLots).toHaveBeenLastCalledWith("acc-1", false);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(useTaxLots).toHaveBeenLastCalledWith("acc-1", true);
  });
});
