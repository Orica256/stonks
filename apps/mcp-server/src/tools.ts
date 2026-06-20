import { z } from "zod";
import {
  AgentAction,
  BenchmarkComparison,
  BenchmarkId,
  Instrument,
  Market,
  Order,
  PerformanceSnapshot,
  PlaceOrderCommand,
  PortfolioSummary,
  PositionView,
  Quote,
} from "@stonks/contracts";
import { ApiClient } from "./api-client.js";

/**
 * MCP ツールの入出力スキーマとハンドラ（spec §6.7）。
 *
 * 入出力は contracts の Zod 型から導出し、手書き型を作らない（CLAUDE.md §0/§2）。
 * ハンドラは ApiClient のみに依存し、ドメインを直接 import しない（spec §4.3）。
 * MCP SDK 非依存にしておくことで、フェイク fetch に対して単体テストできる。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 入力スキーマ（ツール引数）。registerTool には .shape（raw shape）を渡す。
// ─────────────────────────────────────────────────────────────────────────────

export const SearchInstrumentsInput = z.object({
  q: z.string().describe("検索クエリ（銘柄コード/名称の一部）"),
  market: Market.optional().describe("市場フィルタ（JP / US）"),
});

export const GetQuoteInput = z.object({
  instrumentId: z
    .string()
    .min(1)
    .describe("銘柄 ID（正準形式 EXCHANGE:SYMBOL、例 TSE:7203）"),
});

export const GetPortfolioInput = z.object({
  accountId: z.string().min(1).describe("口座 ID"),
});

export const GetPerformanceInput = z.object({
  accountId: z.string().min(1).describe("口座 ID"),
  range: z
    .enum(["1d", "1w", "1m", "3m", "6m", "1y", "ytd", "all"])
    .optional()
    .describe("評価期間（既定 1m）"),
  benchmark: BenchmarkId.optional().describe(
    "比較ベンチマーク（既定 BUY_AND_HOLD）",
  ),
});

/**
 * place_order の order 引数。accountId はツール引数 accountId をパス正準とするため
 * order からは除外する（apps/api と同方針）。形状は PlaceOrderCommand を真実とする。
 */
const OrderInput = PlaceOrderCommand instanceof z.ZodEffects
  ? // PlaceOrderCommand は superRefine 付き（ZodEffects）。内側の object から派生する。
    (PlaceOrderCommand._def.schema as z.ZodObject<z.ZodRawShape>).omit({
      accountId: true,
    })
  : (PlaceOrderCommand as unknown as z.ZodObject<z.ZodRawShape>).omit({
      accountId: true,
    });

export const PlaceOrderInput = z.object({
  accountId: z.string().min(1).describe("発注先口座 ID"),
  order: OrderInput.describe("発注内容（instrumentId / side / type / quantity 等）"),
  rationale: z
    .string()
    .min(1)
    .describe("発注根拠（必須・監査証跡 AgentDecision に記録される）"),
  agentProfileId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "発注主体のエージェントプロファイル ID（省略時は既定プロファイルを使用）",
    ),
});

export const CancelOrderInput = z.object({
  orderId: z.string().min(1).describe("取消する注文 ID"),
});

// ─────────────────────────────────────────────────────────────────────────────
// ハンドラ。各々 ApiClient を受け、検証済みの結果を返す。
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDeps {
  api: ApiClient;
  /** place_order で agentProfileId 未指定時に使う既定プロファイル。 */
  defaultAgentProfileId?: string | undefined;
}

/** GET /instruments?q=&market= */
export const searchInstruments = async (
  deps: ToolDeps,
  args: z.infer<typeof SearchInstrumentsInput>,
): Promise<Instrument[]> => {
  const raw = await deps.api.get("/instruments", {
    q: args.q,
    market: args.market,
  });
  return z.array(Instrument).parse(raw);
};

/** GET /instruments/:id/quote */
export const getQuote = async (
  deps: ToolDeps,
  args: z.infer<typeof GetQuoteInput>,
): Promise<Quote> => {
  const raw = await deps.api.get(
    `/instruments/${encodeURIComponent(args.instrumentId)}/quote`,
  );
  return Quote.parse(raw);
};

/** 口座のサマリと保有を 1 ツールで返す（GET /accounts/:id/summary + /positions）。 */
export const GetPortfolioResult = z.object({
  summary: PortfolioSummary,
  positions: z.array(PositionView),
});
export type GetPortfolioResult = z.infer<typeof GetPortfolioResult>;

export const getPortfolio = async (
  deps: ToolDeps,
  args: z.infer<typeof GetPortfolioInput>,
): Promise<GetPortfolioResult> => {
  const id = encodeURIComponent(args.accountId);
  const [summaryRaw, positionsRaw] = await Promise.all([
    deps.api.get(`/accounts/${id}/summary`),
    deps.api.get(`/accounts/${id}/positions`),
  ]);
  return GetPortfolioResult.parse({
    summary: summaryRaw,
    positions: positionsRaw,
  });
};

/** GET /accounts/:id/performance?range=&benchmark= */
export const GetPerformanceResult = z.object({
  snapshot: PerformanceSnapshot,
  comparison: BenchmarkComparison.nullable(),
});
export type GetPerformanceResult = z.infer<typeof GetPerformanceResult>;

export const getPerformance = async (
  deps: ToolDeps,
  args: z.infer<typeof GetPerformanceInput>,
): Promise<GetPerformanceResult> => {
  const raw = await deps.api.get(
    `/accounts/${encodeURIComponent(args.accountId)}/performance`,
    { range: args.range, benchmark: args.benchmark },
  );
  return GetPerformanceResult.parse(raw);
};

/**
 * place_order。素の発注エンドポイントを叩かず、必ず rationale 付きで
 * POST /accounts/:id/agent-decisions を呼び AgentDecision を生成する
 * （監査証跡なしの発注を許さない。spec §5.2 / §8）。
 */
export const PlaceOrderResult = z.object({
  decisionId: z.string(),
  orders: z.array(Order),
});
export type PlaceOrderResult = z.infer<typeof PlaceOrderResult>;

export const placeOrder = async (
  deps: ToolDeps,
  args: z.infer<typeof PlaceOrderInput>,
): Promise<PlaceOrderResult> => {
  const agentProfileId = args.agentProfileId ?? deps.defaultAgentProfileId;
  if (!agentProfileId) {
    throw new Error(
      "agentProfileId is required (set MCP_DEFAULT_AGENT_PROFILE_ID or pass it explicitly) to record the AgentDecision",
    );
  }

  // order に accountId を補ってから AgentAction(ORDER) を contracts スキーマで構築。
  const action: z.infer<typeof AgentAction> = AgentAction.parse({
    kind: "ORDER",
    order: { ...args.order, accountId: args.accountId },
  });

  const raw = await deps.api.post(
    `/accounts/${encodeURIComponent(args.accountId)}/agent-decisions`,
    {
      agentProfileId,
      rationale: args.rationale,
      actions: [action],
      inputContext: { source: "mcp-server", tool: "place_order" },
    },
  );
  return PlaceOrderResult.parse(raw);
};

/** DELETE /orders/:id */
export const cancelOrder = async (
  deps: ToolDeps,
  args: z.infer<typeof CancelOrderInput>,
): Promise<Order> => {
  const raw = await deps.api.delete(
    `/orders/${encodeURIComponent(args.orderId)}`,
  );
  return Order.parse(raw);
};
