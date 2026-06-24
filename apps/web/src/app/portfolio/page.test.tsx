import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  CapitalGainsTaxEstimate,
  Instrument,
  PortfolioSummary,
  PositionView,
  TaxLot,
} from "@stonks/contracts";
import PortfolioPage from "./page";

/**
 * ポートフォリオ画面の描画テスト（Phase 8.1）。
 * hooks（サーバ状態）はモックし、保有ポジション行に資金区分バッジ（現物/信用）が
 * 表示されることを検証する。未指定（CASH 既定）→現物、MARGIN→信用。
 */

const hookState = {
  positions: {
    data: undefined as PositionView[] | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  summary: {
    data: undefined as PortfolioSummary | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  tax: {
    data: undefined as CapitalGainsTaxEstimate[] | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  taxLots: {
    data: undefined as TaxLot[] | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  instrumentMap: new Map<string, Instrument>(),
};

vi.mock("@/lib/api/hooks", () => ({
  usePositions: () => hookState.positions,
  useSummary: () => hookState.summary,
  useCapitalGainsTax: () => hookState.tax,
  useTaxLots: () => hookState.taxLots,
  useInstrumentMap: () => hookState.instrumentMap,
}));

vi.mock("@/lib/env", () => ({
  DEFAULT_ACCOUNT_ID: "acc-1",
}));

function position(
  partial: Partial<PositionView> & Pick<PositionView, "id" | "instrumentId">,
): PositionView {
  return {
    accountId: "acc-1",
    side: "LONG",
    quantity: 100,
    avgCost: "2500",
    currency: "JPY",
    openedAt: "2026-06-23T00:00:00.000Z",
    marketPrice: "2600",
    marketValue: { amount: "260000", currency: "JPY" },
    unrealizedPnl: { amount: "10000", currency: "JPY" },
    unrealizedPnlPct: 0.04,
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  hookState.positions = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  };
  hookState.summary = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  };
  hookState.tax = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  };
  hookState.taxLots = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  };
  hookState.instrumentMap = new Map<string, Instrument>();
});

describe("PortfolioPage", () => {
  it("保有ポジションが無ければ空表示する", () => {
    hookState.positions = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<PortfolioPage />);
    expect(screen.getByText("保有ポジションはありません。")).toBeInTheDocument();
  });

  it("各行に資金区分バッジを表示する（MARGIN→信用 / 未指定→現物）", () => {
    hookState.positions = {
      data: [
        position({
          id: "p-margin",
          instrumentId: "TSE:7203",
          marginType: "MARGIN",
        }),
        // marginType 未指定 → 現物（CASH 既定）。
        position({ id: "p-cash", instrumentId: "NASDAQ:AAPL", currency: "USD" }),
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<PortfolioPage />);

    expect(screen.getByText("信用")).toBeInTheDocument();
    expect(screen.getByText("現物")).toBeInTheDocument();
  });
});
