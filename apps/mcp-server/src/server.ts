import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { ApiError } from "./api-client.js";
import {
  CancelOrderInput,
  GetPerformanceInput,
  GetPortfolioInput,
  GetQuoteInput,
  PlaceOrderInput,
  SearchInstrumentsInput,
  cancelOrder,
  getPerformance,
  getPortfolio,
  getQuote,
  placeOrder,
  searchInstruments,
  type ToolDeps,
} from "./tools.js";

/**
 * ハンドラの戻り値（任意のオブジェクト）を MCP の CallToolResult 形へ整形する。
 * 構造化出力は structuredContent、人間可読は JSON テキストとして両方返す。
 */
const ok = (data: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(data, null, 2) },
  ],
  structuredContent: data as Record<string, unknown>,
});

/** エラーを isError 付きの CallToolResult に整形（LLM が読める形でメッセージを返す）。 */
const fail = (err: unknown) => {
  const message =
    err instanceof ApiError
      ? `API error ${err.status}: ${err.body}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
};

/** ハンドラを CallToolResult を返すコールバックに包む共通ラッパ。 */
const wrap =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };

/**
 * MCP ツールサーバーを構築する（spec §6.7）。apps/api(HTTP) の薄いラッパとして
 * search_instruments / get_quote / get_portfolio / get_performance /
 * place_order / cancel_order を公開する。入出力は contracts スキーマで検証する。
 */
export const createMcpServer = (deps: ToolDeps): McpServer => {
  const server = new McpServer({
    name: "stonks-mcp",
    version: "0.0.0",
  });

  server.registerTool(
    "search_instruments",
    {
      title: "Search instruments",
      description:
        "銘柄を検索する（コード/名称の一部）。市場（JP/US）で絞り込み可能。",
      inputSchema: SearchInstrumentsInput.shape,
    },
    wrap((args: z.infer<typeof SearchInstrumentsInput>) =>
      searchInstruments(deps, args),
    ),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get quote",
      description: "銘柄の最新気配（last/bid/ask）を取得する。",
      inputSchema: GetQuoteInput.shape,
    },
    wrap((args: z.infer<typeof GetQuoteInput>) => getQuote(deps, args)),
  );

  server.registerTool(
    "get_portfolio",
    {
      title: "Get portfolio",
      description: "口座のサマリ（現金/評価額/損益）と保有ポジション一覧を取得する。",
      inputSchema: GetPortfolioInput.shape,
    },
    wrap((args: z.infer<typeof GetPortfolioInput>) => getPortfolio(deps, args)),
  );

  server.registerTool(
    "get_performance",
    {
      title: "Get performance",
      description:
        "口座の成績スナップショット（累積リターン/最大DD/シャープ/勝率）とベンチ比較を取得する。",
      inputSchema: GetPerformanceInput.shape,
    },
    wrap((args: z.infer<typeof GetPerformanceInput>) =>
      getPerformance(deps, args),
    ),
  );

  server.registerTool(
    "place_order",
    {
      title: "Place order",
      description:
        "発注する。rationale（根拠）必須。内部で AgentDecision（監査証跡）を生成してから約定を委譲する。",
      inputSchema: PlaceOrderInput.shape,
    },
    wrap((args: z.infer<typeof PlaceOrderInput>) => placeOrder(deps, args)),
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description: "オープン注文を取消する。",
      inputSchema: CancelOrderInput.shape,
    },
    wrap((args: z.infer<typeof CancelOrderInput>) => cancelOrder(deps, args)),
  );

  return server;
};
