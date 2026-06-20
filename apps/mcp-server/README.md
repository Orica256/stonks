# @stonks/mcp-server

LLM（Claude Code 等）がシミュレーション内で**対話しながら手動売買**するための MCP
ツールサーバー（spec §2.7 / §6.7）。`apps/api`（HTTP）の薄いラッパであり、
ドメイン（trading-engine / portfolio / agent-trader 等）や DB を一切直接 import せず、
REST 経由でのみ結合する（spec §4.3「mcp-server → contracts ＋ API(HTTP) のみ」）。

実マネー・実発注（ブローカー API）には**絶対に接続しない**。すべてペーパートレード
シミュレーション内の操作（CLAUDE.md §7 / §8）。

## 責務

- 売買・参照の各操作を MCP ツールとして LLM に公開する。
- ツール入出力は `@stonks/contracts` の Zod 型から導出して検証する（手書き型は作らない）。
- `place_order` は **rationale 必須**。素の発注エンドポイントを叩かず、
  `POST /accounts/:id/agent-decisions` を呼んで **AgentDecision（監査証跡）を必ず生成**
  してから約定を委譲する（spec §5.2 不変条件 / §8）。

## ツール一覧（spec §6.7）

| ツール | 引数 | 叩く API | 返却 |
| --- | --- | --- | --- |
| `search_instruments` | `q`, `market?`(JP/US) | `GET /instruments?q=&market=` | `Instrument[]` |
| `get_quote` | `instrumentId` | `GET /instruments/:id/quote` | `Quote` |
| `get_portfolio` | `accountId` | `GET /accounts/:id/summary` ＋ `/positions` | `{ summary, positions }` |
| `get_performance` | `accountId`, `range?`, `benchmark?` | `GET /accounts/:id/performance` | `{ snapshot, comparison }` |
| `place_order` | `accountId`, `order`, `rationale`, `agentProfileId?` | `POST /accounts/:id/agent-decisions` | `{ decisionId, orders }` |
| `cancel_order` | `orderId` | `DELETE /orders/:id` | `Order` |

- `order` は `PlaceOrderCommand` から `accountId` を除いた形状（`accountId` はパス正準）。
- `place_order` の `agentProfileId` は省略可。省略時は `MCP_DEFAULT_AGENT_PROFILE_ID`
  を使う。どちらも無い場合は、監査証跡を残せないためエラーにする（発注しない）。
- `range` は `1d|1w|1m|3m|6m|1y|ytd|all`（既定 `1m`）。`benchmark` は
  `BUY_AND_HOLD|TOPIX|SP500`（既定 `BUY_AND_HOLD`）。

## 環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `MCP_API_BASE_URL` | `http://localhost:${API_PORT}` | 叩く `apps/api` のベース URL |
| `MCP_DEFAULT_AGENT_PROFILE_ID` | （未設定） | `place_order` 既定のエージェントプロファイル |
| `MCP_REQUEST_TIMEOUT_MS` | `15000` | API 呼び出しタイムアウト（ms） |
| `API_PORT` | `3001` | `MCP_API_BASE_URL` 未指定時のフォールバックに使用 |

秘密情報（LLM キー等）はこのプロセスでは扱わない。

## 起動

stdio トランスポートで動く。MCP クライアント（Claude Code 等）の設定から
このコマンドを起動する。stdout は JSON-RPC 専用のため、ログは stderr に出る。

```bash
# 開発（watch）
corepack pnpm@9.12.0 --filter @stonks/mcp-server dev

# ビルド済みを起動
corepack pnpm@9.12.0 --filter @stonks/mcp-server build
corepack pnpm@9.12.0 --filter @stonks/mcp-server start
```

MCP クライアント設定例（stdio）:

```json
{
  "mcpServers": {
    "stonks": {
      "command": "node",
      "args": ["apps/mcp-server/dist/main.js"],
      "env": {
        "MCP_API_BASE_URL": "http://localhost:3001",
        "MCP_DEFAULT_AGENT_PROFILE_ID": "<agent profile id>"
      }
    }
  }
}
```

## 検証

```bash
corepack pnpm@9.12.0 --filter @stonks/mcp-server typecheck
corepack pnpm@9.12.0 --filter @stonks/mcp-server lint
corepack pnpm@9.12.0 --filter @stonks/mcp-server test
```

テストは実 api・実ネットワークに依存せず、`fetch` をフェイクに差し替えて
ツールハンドラを検証する（CLAUDE.md §3）。

## 設計メモ

- `src/config.ts` — env から `McpConfig` を導出。
- `src/api-client.ts` — `fetch` を注入可能にした apps/api の JSON クライアント。
- `src/tools.ts` — 各ツールの入出力スキーマ（contracts 由来）と純粋ハンドラ（MCP SDK 非依存）。
- `src/server.ts` — ハンドラを MCP `McpServer` に登録。
- `src/main.ts` — stdio トランスポートで接続するエントリポイント。
