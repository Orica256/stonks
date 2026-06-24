import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import {
  DomainError,
  type MarginPolicy,
  type MarginPolicyProvider,
  type MarginRequirement,
  type Money,
  type PriceProvider,
} from "@stonks/contracts";
import {
  computeMarginRequirement,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import { TOKENS } from "../common/tokens.js";

/**
 * 必要保証金プレビュー（spec §2.2 P2 / §6.8）:
 *   GET /instruments/:id/margin-requirement?side=&quantity=&price=&marginType=
 *
 * 信用建て（MARGIN）前提で、発注前に必要保証金（MarginRequirement 契約型）を返す。
 * 保証金計算そのものは trading-engine の純関数 `computeMarginRequirement` を使い、
 * ここでは「銘柄解決・信用可否の事前抑止・最新価格の補完・ポリシー解決」のみ担う
 * （計算を再実装しない＝唯一の真実は trading-engine / contracts）。
 *
 * エラーはすべて DomainError で投げ、DomainExceptionFilter が HTTP へマップする
 * （NOT_FOUND→404 / VALIDATION→400）。
 *
 * 注意: ルートは MarketDataController の `instruments/:id`・`instruments/:id/bars` 等とは
 * 別サブパスのため衝突しない。MarginPolicyProvider を要するため trading モジュールに置く。
 */
@Controller()
export class MarginController {
  constructor(
    @Inject(TOKENS.InstrumentProvider)
    private readonly instruments: InstrumentProvider,
    @Inject(TOKENS.PriceProvider)
    private readonly prices: PriceProvider,
    @Inject(TOKENS.MarginPolicyProvider)
    private readonly marginPolicy: MarginPolicyProvider,
  ) {}

  @Get("instruments/:id/margin-requirement")
  async marginRequirement(
    @Param("id") id: string,
    @Query("side") side?: string,
    @Query("quantity") quantity?: string,
    @Query("price") price?: string,
    @Query("marginType") marginType?: string,
  ): Promise<MarginRequirement> {
    const orderSide = parseSide(side);
    const qty = parseQuantity(quantity);
    const priceArg = price !== undefined ? parsePrice(price) : undefined;
    const mType = parseMarginType(marginType);

    // CASH は保証金不要。このエンドポイントは信用建て前提のため明示的に弾く。
    if (mType === "CASH") {
      throw new DomainError(
        "VALIDATION",
        "margin-requirement applies to MARGIN orders only (CASH requires no margin)",
      );
    }

    // 1. 銘柄解決（未存在は 404）。
    const instrument = await this.instruments.getById(id);
    if (!instrument) {
      throw new DomainError("NOT_FOUND", `instrument not found: ${id}`);
    }

    // 2. 信用可否の事前抑止（銘柄マスタ由来の制度上の可否）。
    //    undefined（不明）は抑止せず通す。明示 false のときのみ弾く。
    if (orderSide === "BUY" && instrument.marginTradable === false) {
      throw new DomainError(
        "VALIDATION",
        `margin buy (shinyo) is not allowed for instrument: ${id}`,
      );
    }
    if (orderSide === "SELL" && instrument.shortMarginable === false) {
      throw new DomainError(
        "VALIDATION",
        `margin short (kara-uri) is not allowed for instrument: ${id}`,
      );
    }

    // 3. ポリシー解決（null = 信用不可＝ポリシー未設定）。
    const policy: MarginPolicy | null =
      await this.marginPolicy.getMarginPolicy(id);
    if (!policy) {
      throw new DomainError(
        "VALIDATION",
        `margin policy is not configured for instrument (credit not allowed): ${id}`,
      );
    }

    // 4. price 未指定なら最新価格を取得（DecimalString のまま使う）。
    let priceStr: string;
    if (priceArg !== undefined) {
      priceStr = priceArg;
    } else {
      const latest: Money = await this.prices.getLatestPrice(id);
      priceStr = latest.amount;
    }

    // 5. 必要保証金を計算して契約型そのまま返す。
    return computeMarginRequirement({
      quantity: qty,
      price: priceStr,
      policy,
      currency: instrument.currency,
    });
  }
}

/** side クエリ（BUY|SELL。必須）を検証する。 */
function parseSide(raw: string | undefined): "BUY" | "SELL" {
  if (raw === "BUY" || raw === "SELL") return raw;
  throw new DomainError("VALIDATION", "side must be BUY or SELL");
}

/** quantity クエリ（正の整数。必須）を検証する。 */
function parseQuantity(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    throw new DomainError("VALIDATION", "quantity is required");
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new DomainError("VALIDATION", "quantity must be a positive integer");
  }
  return n;
}

/** price クエリ（DecimalString。任意）を検証する。 */
function parsePrice(raw: string): string {
  const v = raw.trim();
  // DecimalString（浮動小数禁止。文字列のまま扱う）。負値は受け付けない。
  if (!/^\d+(\.\d+)?$/.test(v)) {
    throw new DomainError(
      "VALIDATION",
      "price must be a non-negative decimal string",
    );
  }
  return v;
}

/** marginType クエリ（任意。既定 MARGIN）を検証する。 */
function parseMarginType(raw: string | undefined): "CASH" | "MARGIN" {
  if (raw === undefined || raw.trim() === "") return "MARGIN";
  if (raw === "CASH" || raw === "MARGIN") return raw;
  throw new DomainError("VALIDATION", "marginType must be CASH or MARGIN");
}
