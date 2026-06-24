import { describe, expect, it } from "vitest";
import {
  effectiveMarginType,
  marginBadgeClassName,
  marginTypeLabel,
} from "./margin-display";

/**
 * 資金区分の表示ヘルパ（Phase 8.1）の単体テスト。
 * 未指定（undefined）は現物（CASH）扱い、CASH→現物 / MARGIN→信用、を保証する。
 */

describe("effectiveMarginType", () => {
  it("未指定は CASH に正規化する", () => {
    expect(effectiveMarginType(undefined)).toBe("CASH");
  });

  it("指定値はそのまま返す", () => {
    expect(effectiveMarginType("CASH")).toBe("CASH");
    expect(effectiveMarginType("MARGIN")).toBe("MARGIN");
  });
});

describe("marginTypeLabel", () => {
  it("CASH は現物", () => {
    expect(marginTypeLabel("CASH")).toBe("現物");
  });

  it("MARGIN は信用", () => {
    expect(marginTypeLabel("MARGIN")).toBe("信用");
  });

  it("未指定は現物（CASH 既定）", () => {
    expect(marginTypeLabel(undefined)).toBe("現物");
  });
});

describe("marginBadgeClassName", () => {
  it("CASH と MARGIN でトーンが異なる", () => {
    expect(marginBadgeClassName("CASH")).not.toBe(
      marginBadgeClassName("MARGIN"),
    );
  });

  it("未指定は CASH と同じトーン", () => {
    expect(marginBadgeClassName(undefined)).toBe(marginBadgeClassName("CASH"));
  });
});
