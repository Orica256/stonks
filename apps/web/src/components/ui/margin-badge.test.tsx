import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarginBadge } from "./margin-badge";

/**
 * 資金区分バッジ（Phase 8.1）の描画テスト。
 * CASH→現物 / MARGIN→信用 / undefined→現物（CASH 既定）を検証する。
 */

afterEach(() => cleanup());

describe("MarginBadge", () => {
  it("CASH は現物を表示する", () => {
    render(<MarginBadge marginType="CASH" />);
    expect(screen.getByText("現物")).toBeInTheDocument();
  });

  it("MARGIN は信用を表示する", () => {
    render(<MarginBadge marginType="MARGIN" />);
    expect(screen.getByText("信用")).toBeInTheDocument();
  });

  it("未指定は現物を表示する", () => {
    render(<MarginBadge marginType={undefined} />);
    expect(screen.getByText("現物")).toBeInTheDocument();
  });
});
