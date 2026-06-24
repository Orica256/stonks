import { describe, expect, it } from "vitest";
import {
  parseMarginEligibilityEnv,
  resolveMarginEligibility,
} from "./margin-eligibility.js";

describe("resolveMarginEligibility (rule-based defaults)", () => {
  it("US stock: margin buy and short both default to true", () => {
    expect(
      resolveMarginEligibility({
        id: "NASDAQ:AAPL",
        market: "US",
        type: "STOCK",
      }),
    ).toEqual({ marginTradable: true, shortMarginable: true });
  });

  it("US ETF: same as US stock", () => {
    expect(
      resolveMarginEligibility({ id: "NYSE:SPY", market: "US", type: "ETF" }),
    ).toEqual({ marginTradable: true, shortMarginable: true });
  });

  it("JP stock: margin buy true, short undefined (omitted, not false)", () => {
    const r = resolveMarginEligibility({
      id: "TSE:7203",
      market: "JP",
      type: "STOCK",
    });
    expect(r).toEqual({ marginTradable: true });
    expect("shortMarginable" in r).toBe(false);
  });

  it("JP ETF: margin buy true, short undefined", () => {
    const r = resolveMarginEligibility({
      id: "TSE:1306",
      market: "JP",
      type: "ETF",
    });
    expect(r).toEqual({ marginTradable: true });
  });
});

describe("resolveMarginEligibility (overrides)", () => {
  it("override is highest priority and per-flag", () => {
    const opts = {
      overrides: {
        "NASDAQ:AAPL": { marginTradable: false },
      },
    };
    // marginTradable override wins; shortMarginable falls back to rule (US=true).
    expect(
      resolveMarginEligibility(
        { id: "NASDAQ:AAPL", market: "US", type: "STOCK" },
        opts,
      ),
    ).toEqual({ marginTradable: false, shortMarginable: true });
  });

  it("can set JP shortMarginable explicitly (shakushaku brand)", () => {
    const opts = { overrides: { "TSE:7203": { shortMarginable: true } } };
    expect(
      resolveMarginEligibility(
        { id: "TSE:7203", market: "JP", type: "STOCK" },
        opts,
      ),
    ).toEqual({ marginTradable: true, shortMarginable: true });
  });

  it("override with false for an unknown JP rule still emits false", () => {
    const opts = { overrides: { "TSE:9999": { shortMarginable: false } } };
    expect(
      resolveMarginEligibility(
        { id: "TSE:9999", market: "JP", type: "STOCK" },
        opts,
      ),
    ).toEqual({ marginTradable: true, shortMarginable: false });
  });

  it("override for a different id is ignored", () => {
    const opts = { overrides: { "NASDAQ:MSFT": { marginTradable: false } } };
    expect(
      resolveMarginEligibility(
        { id: "NASDAQ:AAPL", market: "US", type: "STOCK" },
        opts,
      ),
    ).toEqual({ marginTradable: true, shortMarginable: true });
  });
});

describe("parseMarginEligibilityEnv", () => {
  it("empty env yields no overrides", () => {
    expect(parseMarginEligibilityEnv({})).toEqual({});
  });

  it("MARGIN_TRADABLE_OVERRIDES: bare id defaults to true", () => {
    expect(
      parseMarginEligibilityEnv({ MARGIN_TRADABLE_OVERRIDES: "TSE:9984" }),
    ).toEqual({ overrides: { "TSE:9984": { marginTradable: true } } });
  });

  it("explicit false flag is parsed (third colon segment)", () => {
    expect(
      parseMarginEligibilityEnv({
        MARGIN_TRADABLE_OVERRIDES: "TSE:1234:false",
      }),
    ).toEqual({ overrides: { "TSE:1234": { marginTradable: false } } });
  });

  it("merges both env vars on the same id", () => {
    expect(
      parseMarginEligibilityEnv({
        MARGIN_TRADABLE_OVERRIDES: "TSE:7203:true",
        SHORT_MARGINABLE_OVERRIDES: "TSE:7203:true",
      }),
    ).toEqual({
      overrides: { "TSE:7203": { marginTradable: true, shortMarginable: true } },
    });
  });

  it("parses multiple comma-separated tokens with mixed flags", () => {
    expect(
      parseMarginEligibilityEnv({
        SHORT_MARGINABLE_OVERRIDES: "TSE:7203:true, TSE:1234:false ,TSE:9984",
      }),
    ).toEqual({
      overrides: {
        "TSE:7203": { shortMarginable: true },
        "TSE:1234": { shortMarginable: false },
        "TSE:9984": { shortMarginable: true },
      },
    });
  });

  it("accepts +/- and 1/0 boolean tokens", () => {
    expect(
      parseMarginEligibilityEnv({
        MARGIN_TRADABLE_OVERRIDES: "TSE:1:+,TSE:2:-,TSE:3:1,TSE:4:0",
      }),
    ).toEqual({
      overrides: {
        "TSE:1": { marginTradable: true },
        "TSE:2": { marginTradable: false },
        "TSE:3": { marginTradable: true },
        "TSE:4": { marginTradable: false },
      },
    });
  });

  it("skips tokens with an unrecognized flag", () => {
    expect(
      parseMarginEligibilityEnv({
        MARGIN_TRADABLE_OVERRIDES: "TSE:1234:maybe",
      }),
    ).toEqual({});
  });
});
