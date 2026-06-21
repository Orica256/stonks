# @stonks/agent-runner

AI エージェントの**自律売買ループ**（spec §2.7 P1 / §4.1）。BullMQ で定期実行し、
市況・保有・成績の観測を LLM（`DecisionProvider`）に渡して売買判断を**自動執行**する。
`apps/api`（HTTP）の薄いラッパであり、ドメイン（trading-engine / portfolio /
market-data 等）や DB を一切直接 import せず REST 経由でのみ結合する
（spec §4.3「agent-runner → contracts ＋ agent-trader ＋ API(HTTP)」）。

実マネー・実発注（ブローカー API）には**絶対に接続しない**。すべてペーパートレード
シミュレーション内の操作（CLAUDE.md §7 / §8）。

## 責務

- BullMQ の繰り返しジョブ（cron）で自律ループを定期起動する。
- 1 反復ごとに `GET /accounts/:id/observation` で観測を取り、`DecisionProvider` で判断し、
  **rationale 付き `AgentDecision`** を `POST /accounts/:id/agent-decisions` で記録する
  （監査証跡の欠落を許さない。spec §5.2 不変条件 / §8）。
- 暴走防止（§9）: `enabled` フラグ・実行頻度（cron）・1 ループあたりの発注上限を尊重。
  発注の受理可否（金額/集中度/現金）は **api 側 `RiskGuard` が `AgentProfile.riskLimits`
  に基づき強制**するため、ランナーは二重防御として上限と enabled のみを持つ。

## ループ仕様（1 反復）

1. `enabled=false` → 何もしない（観測すら取りに行かない）。`accountId`/`profileId` 未設定→skip。
2. `GET /accounts/:id/observation` → `AgentObservation`（市況/保有/成績の要約。現時点情報のみ＝ルックアヘッド無し）。
3. `DecisionProvider.decide({ observation, model, strategyPrompt? })` → `{ rationale, actions }`。
4. `rationale` が空なら発注せず破棄（監査証跡必須）。
5. `actions` を contracts スキーマで検証し、ORDER/CANCEL を `AGENT_RUNNER_MAX_ACTIONS` 件まで間引く（HOLD は数えない）。
6. `POST /accounts/:id/agent-decisions`（`agentProfileId` / `rationale` / `actions` / `inputContext=観測`）→ `{ decisionId, orders }`。

## DecisionProvider（LLM 判断の注入点）

LLM 判断は `DecisionProvider { decide(input): Promise<{ rationale, actions }> }` として
注入する。config（`AGENT_RUNNER_PROVIDER`）で差し替え可能:

- `hold`（既定）: 無 LLM・無課金・無ネットワークの安全プロバイダ。常に HOLD を返し発注しない。
  配線（観測→判断→記録）の検証やドライランに使う。
- `llm`: 実 LLM（**Anthropic Claude**）呼び出しを行う `LlmDecisionProvider`（`llm-decision-provider.ts`）。
  **呼び出しごとに LLM 利用料が発生**する。`AGENT_RUNNER_PROVIDER=llm` を**明示**し、かつ
  `ANTHROPIC_API_KEY` が設定されているときのみ実 LLM を呼ぶ。キーが無ければ `provider=llm` でも
  警告して HOLD にフォールバックする（誤った未認証呼び出し/暴走/誤課金を防ぐ）。

### `llm` プロバイダの仕様（`LlmDecisionProvider`）

- パッケージ: `@anthropic-ai/sdk`（OSS。利用料=API 課金はアプリのインフラ無料制約とは別枠。spec §2.7）。
- クライアント: `new Anthropic()`。**API キーは SDK が env `ANTHROPIC_API_KEY` から自動解決**する。
  キーは `provider-factory.ts` で「存在判定」にのみ使い、`RunnerConfig`・ログ・コミットに値を載せない。
- 呼び出し: 非ストリーミング・ツールなしのテキスト補完（`messages.create`）。`model` は
  `AGENT_LLM_MODEL`（既定 `claude-opus-4-8`）をそのまま渡す。`temperature`/`top_p`/`budget_tokens` は付けない。
- 応答: `{ rationale: string, actions: AgentAction[] }` の JSON を期待し、**contracts の Zod スキーマ
  （`AgentAction`）で検証**する。次のいずれでも必ず **HOLD にフォールバック**し、発注せずループを継続する
  （例外を上位に投げない。spec §8/§9 暴走防止）:
  - 応答が空 / 非 JSON / スキーマ不一致（不正な発注コマンドを含む）
  - Anthropic API エラー（`Anthropic.APIError` / `RateLimitError` 等）・ネットワーク失敗
- 失敗時はその旨を stderr（`logger.warn`/`error`）に出すが、鍵・観測の生データを過剰に晒さない。

テストは実 LLM・実ネットワーク・実 Redis を使わず、Anthropic SDK の `messages.create` を
フェイク/モックに差し替えて検証する（CLAUDE.md §3）。`provider-factory` のキー有無による分岐も
注入 env で検証する。

## 暴走防止（§8 / §9）

- `AGENT_RUNNER_ENABLED` 既定 **false**。明示的にオプトインさせる。
- 既定 cron は **1 日 1 回**（`0 0 * * *`）。頻度・課金を控えめに。
- `AGENT_RUNNER_MAX_ACTIONS`（既定 3）で 1 ループの ORDER/CANCEL を上限。超過分は捨てる。
- 全発注に rationale 付き `AgentDecision` を必ず残す。空 rationale は破棄。
- 最終的な発注受理は api 側 `RiskGuard`（1注文/1日上限・集中度・現金）が判定する。

## LLM コスト注記（spec §2.7 / CLAUDE.md §8）

自律ループは `provider=llm` かつ `ANTHROPIC_API_KEY` 設定時に **Anthropic Claude の API を呼び、
LLM 利用料が発生**する（`@anthropic-ai/sdk` 経由）。アプリのインフラのローカル・無料制約（§0）は
インフラに対するもので、LLM 利用料は別枠。既定は控えめ（`provider=hold`・無課金、`enabled=false`、
1 日 1 回 cron）。頻度（cron）・モデル（`AGENT_LLM_MODEL`）・1 ループ発注数を設定で抑制できる。

## 環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `AGENT_RUNNER_ENABLED` | `false` | 自律ループの有効化（暴走/課金防止のため既定 off） |
| `AGENT_RUNNER_API_BASE_URL` | `http://localhost:${API_PORT}` | 叩く apps/api のベース URL |
| `AGENT_RUNNER_REQUEST_TIMEOUT_MS` | `15000` | api 呼び出しタイムアウト（ms） |
| `AGENT_RUNNER_ACCOUNT_ID` | `""` | 回す AGENT 口座 ID |
| `AGENT_RUNNER_PROFILE_ID` | `""` | 発注主体のエージェントプロファイル ID（監査証跡に必須） |
| `AGENT_RUNNER_PROVIDER` | `hold` | 判断プロバイダ（`hold`=無LLM / `llm`=実LLM・課金、要 `ANTHROPIC_API_KEY`） |
| `AGENT_LLM_MODEL` | `claude-opus-4-8` | 判断に用いる LLM モデル名（`provider=llm` で Anthropic に渡す） |
| `AGENT_RUNNER_CRON` | `0 0 * * *` | 自律ループの cron（既定 1 日 1 回） |
| `AGENT_RUNNER_MAX_ACTIONS` | `3` | 1 ループの最大発注（ORDER/CANCEL）数 |
| `AGENT_RUNNER_SCHEDULE_ENABLED` | `true` | 繰り返し登録するか（false なら consumer のみ） |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ 接続 URL |
| `ANTHROPIC_API_KEY` | `""` | Anthropic Claude の API キー（`provider=llm` 用・秘密情報）。SDK が自動解決。未設定なら `provider=llm` でも HOLD にフォールバック（無課金） |

秘密情報（LLM キー）は `.env`（コミット禁止）にのみ置く。`.env.example` には項目だけ記載。

## 起動

```
pnpm --filter @stonks/agent-runner dev    # tsx watch
pnpm --filter @stonks/agent-runner build && pnpm --filter @stonks/agent-runner start
docker compose up -d redis                # BullMQ 用 Redis
```

`enabled=false`（既定）の起動は接続のみで何もスケジュールしない（安全）。有効化するには
`AGENT_RUNNER_ENABLED=true` と口座/プロファイル ID を設定する。SIGINT/SIGTERM で
Worker → Queue → Redis の順にグレースフルに停止する。

## テスト / 型チェック

```
pnpm --filter @stonks/agent-runner typecheck
pnpm --filter @stonks/agent-runner test
```

ループ・スケジューラ・設定の単体テストはすべて**フェイク**（fetch / DecisionProvider）
に対して実行し、実 Redis / 実 LLM / 実 HTTP に依存しない。
