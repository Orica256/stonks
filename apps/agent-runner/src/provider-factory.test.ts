import { describe, expect, it, vi } from "vitest";
import { loadRunnerConfig } from "./config.js";
import { HoldDecisionProvider } from "./decision-provider.js";
import { LlmDecisionProvider } from "./llm-decision-provider.js";
import { createDecisionProvider } from "./provider-factory.js";

/**
 * provider-factory の単体テスト。実 LLM・実 env には依存せず、注入した env で分岐を検証する。
 *
 * 重点:
 *  - 既定(provider=hold) は常に HoldDecisionProvider（無 LLM・無課金）
 *  - provider=llm かつ ANTHROPIC_API_KEY あり → LlmDecisionProvider
 *  - provider=llm でも API キー無し → HOLD にフォールバック（誤った未認証呼び出し防止）
 */

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("createDecisionProvider", () => {
  it("returns HoldDecisionProvider by default (provider=hold)", () => {
    const cfg = loadRunnerConfig({});
    const provider = createDecisionProvider(cfg, silentLogger, {});
    expect(provider).toBeInstanceOf(HoldDecisionProvider);
  });

  it("returns LlmDecisionProvider when provider=llm and ANTHROPIC_API_KEY is set", () => {
    const cfg = loadRunnerConfig({ AGENT_RUNNER_PROVIDER: "llm" });
    const provider = createDecisionProvider(cfg, silentLogger, {
      ANTHROPIC_API_KEY: "sk-test-xxx",
    });
    expect(provider).toBeInstanceOf(LlmDecisionProvider);
  });

  it("falls back to HOLD when provider=llm but ANTHROPIC_API_KEY is missing", () => {
    const cfg = loadRunnerConfig({ AGENT_RUNNER_PROVIDER: "llm" });
    const warn = vi.fn();
    const provider = createDecisionProvider(
      cfg,
      { info: vi.fn(), warn, error: vi.fn() },
      {},
    );
    expect(provider).toBeInstanceOf(HoldDecisionProvider);
    expect(warn).toHaveBeenCalled();
  });

  it("treats a blank ANTHROPIC_API_KEY as missing", () => {
    const cfg = loadRunnerConfig({ AGENT_RUNNER_PROVIDER: "llm" });
    const provider = createDecisionProvider(cfg, silentLogger, {
      ANTHROPIC_API_KEY: "   ",
    });
    expect(provider).toBeInstanceOf(HoldDecisionProvider);
  });

  it("does not leak the API key value to logs", () => {
    const cfg = loadRunnerConfig({ AGENT_RUNNER_PROVIDER: "llm" });
    const info = vi.fn();
    createDecisionProvider(cfg, { info, warn: vi.fn(), error: vi.fn() }, {
      ANTHROPIC_API_KEY: "sk-secret-value",
    });
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("sk-secret-value");
  });
});
