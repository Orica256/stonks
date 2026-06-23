import { describe, expect, it } from "vitest";
import { PlaceBracketOrderCommand } from "@stonks/contracts";
import {
  activationLabel,
  buildBracketCommand,
  emptyLeg,
  linkTypeLabel,
  needsLimit,
  needsStop,
  type BracketFormState,
  type LegInput,
} from "./bracket";

/**
 * 複合注文フォームの純粋ロジック（ペイロード組み立て・最低限検証・表示ラベル）のテスト。
 * 価格は DecimalString（文字列）のまま渡り、契約 PlaceBracketOrderCommand に適合する。
 */

function leg(over: Partial<LegInput>): LegInput {
  return { ...emptyLeg(), ...over };
}

describe("needsLimit / needsStop", () => {
  it("注文種別ごとに必要な価格を判定する", () => {
    expect(needsLimit("LIMIT")).toBe(true);
    expect(needsLimit("STOP_LIMIT")).toBe(true);
    expect(needsLimit("MARKET")).toBe(false);
    expect(needsStop("STOP")).toBe(true);
    expect(needsStop("STOP_LIMIT")).toBe(true);
    expect(needsStop("LIMIT")).toBe(false);
  });
});

describe("buildBracketCommand: OCO", () => {
  it("2 脚を OCO コマンドに組み立て、契約スキーマに適合する", () => {
    const state: BracketFormState = {
      kind: "OCO",
      legs: [
        leg({ side: "SELL", type: "LIMIT", quantity: "100", limitPrice: "1500" }),
        leg({ side: "SELL", type: "STOP", quantity: "100", stopPrice: "1200" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "GTC");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.kind).toBe("OCO");
    if (result.command.kind !== "OCO") return;
    expect(result.command.legs[0]).toMatchObject({
      instrumentId: "TSE:7203",
      side: "SELL",
      type: "LIMIT",
      quantity: 100,
      limitPrice: "1500",
      timeInForce: "GTC",
    });
    // 価格は文字列のまま（浮動小数化しない）。
    expect(typeof (result.command.legs[0] as { limitPrice: string }).limitPrice).toBe(
      "string",
    );
    // 契約スキーマに適合する。
    expect(PlaceBracketOrderCommand.safeParse(result.command).success).toBe(true);
  });

  it("数量が 0 以下ならエラーを返す", () => {
    const state: BracketFormState = {
      kind: "OCO",
      legs: [
        leg({ type: "MARKET", quantity: "0" }),
        leg({ type: "MARKET", quantity: "100" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("数量");
  });

  it("指値種別で指値価格が空ならエラーを返す", () => {
    const state: BracketFormState = {
      kind: "OCO",
      legs: [
        leg({ type: "LIMIT", quantity: "100", limitPrice: "" }),
        leg({ type: "MARKET", quantity: "100" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("指値");
  });
});

describe("buildBracketCommand: IFD", () => {
  it("親 1 ＋ 子 N を IFD コマンドに組み立てる", () => {
    const state: BracketFormState = {
      kind: "IFD",
      legs: [
        leg({ side: "BUY", type: "LIMIT", quantity: "100", limitPrice: "1000" }),
        leg({ side: "SELL", type: "LIMIT", quantity: "100", limitPrice: "1100" }),
        leg({ side: "SELL", type: "STOP", quantity: "100", stopPrice: "900" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.kind).toBe("IFD");
    if (result.command.kind !== "IFD") return;
    expect(result.command.children).toHaveLength(2);
    expect(PlaceBracketOrderCommand.safeParse(result.command).success).toBe(true);
  });

  it("子の逆指値価格が不正ならエラーを返す", () => {
    const state: BracketFormState = {
      kind: "IFD",
      legs: [
        leg({ type: "MARKET", quantity: "100" }),
        leg({ type: "STOP", quantity: "100", stopPrice: "abc" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("逆指値");
  });
});

describe("buildBracketCommand: BRACKET", () => {
  it("親 1 ＋ 子 2 を BRACKET コマンドに組み立てる", () => {
    const state: BracketFormState = {
      kind: "BRACKET",
      legs: [
        leg({ side: "BUY", type: "MARKET", quantity: "100" }),
        leg({ side: "SELL", type: "LIMIT", quantity: "100", limitPrice: "1200" }),
        leg({ side: "SELL", type: "STOP", quantity: "100", stopPrice: "800" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.kind).toBe("BRACKET");
    if (result.command.kind !== "BRACKET") return;
    expect(result.command.children).toHaveLength(2);
    expect(PlaceBracketOrderCommand.safeParse(result.command).success).toBe(true);
  });

  it("子が 2 本でない（脚数不一致）ならエラーを返す", () => {
    const state: BracketFormState = {
      kind: "BRACKET",
      legs: [
        leg({ type: "MARKET", quantity: "100" }),
        leg({ type: "LIMIT", quantity: "100", limitPrice: "1200" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(false);
  });

  it("送信ペイロードに accountId を含めない（パス注入のため）", () => {
    const state: BracketFormState = {
      kind: "BRACKET",
      legs: [
        leg({ type: "MARKET", quantity: "100" }),
        leg({ type: "LIMIT", quantity: "100", limitPrice: "1200" }),
        leg({ type: "STOP", quantity: "100", stopPrice: "800" }),
      ],
    };
    const result = buildBracketCommand(state, "TSE:7203", "DAY");
    expect(result.ok).toBe(true);
    if (!result.ok || result.command.kind !== "BRACKET") return;
    expect(result.command.parent).not.toHaveProperty("accountId");
    expect(result.command.children[0]).not.toHaveProperty("accountId");
  });
});

describe("表示ラベル", () => {
  it("発効状態を日本語に変換する（未指定/ACTIVE は有効、WAITING は待機）", () => {
    expect(activationLabel(undefined)).toBe("有効");
    expect(activationLabel("ACTIVE")).toBe("有効");
    expect(activationLabel("WAITING")).toBe("待機（親約定待ち）");
  });

  it("リンク種別を日本語に変換する", () => {
    expect(linkTypeLabel("OCO")).toBe("OCO");
    expect(linkTypeLabel("IFD")).toBe("IFD");
    expect(linkTypeLabel(undefined)).toBe("単発");
  });
});
