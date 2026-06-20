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
- `llm`: 実 LLM 呼び出し（**課金が発生**）を行う実装に差し替える想定。現状その実装は未提供で、
  指定しても警告して HOLD にフォールバックする（誤課金/暴走防止）。実装追加時は LLM キー
  （`ANTHROPIC_API_KEY` 等）を `provider-factory.ts` 内でのみ読み、`RunnerConfig` に秘密情報を載せない。

テストは実 LLM・実ネットワーク・実 Redis を使わず、フェイク `DecisionProvider` と
フェイク `fetch` に対して検証する（CLAUDE.md §3）。

## 暴走防止（§8 / §9）

- `AGENT_RUNNER_ENABLED` 既定 **false**。明示的にオプトインさせる。
- 既定 cron は **1 日 1 回**（`0 0 * * *`）。頻度・課金を控えめに。
- `AGENT_RUNNER_MAX_ACTIONS`（既定 3）で 1 ループの ORDER/CANCEL を上限。超過分は捨てる。
- 全発注に rationale 付き `AgentDecision` を必ず残す。空 rationale は破棄。
- 最終的な発注受理は api 側 `RiskGuard`（1注文/1日上限・集中度・現金）が判定する。

## LLM コスト注記（spec §2.7 / CLAUDE.md §8）

自律ループは `provider=llm` の場合 **LLM 呼び出し料金が発生**する。アプリのインフラの
ローカル・無料制約（§0）はインフラに対するもので、LLM 利用料は別枠。頻度（cron）・
モデル（`AGENT_LLM_MODEL`）・1 ループ発注数を設定で抑制し、既定は控えめにしている。

## 環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `AGENT_RUNNER_ENABLED` | `false` | 自律ループの有効化（暴走/課金防止のため既定 off） |
| `AGENT_RUNNER_API_BASE_URL` | `http://localhost:${API_PORT}` | 叩く apps/api のベース URL |
| `AGENT_RUNNER_REQUEST_TIMEOUT_MS` | `15000` | api 呼び出しタイムアウト（ms） |
| `AGENT_RUNNER_ACCOUNT_ID` | `""` | 回す AGENT 口座 ID |
| `AGENT_RUNNER_PROFILE_ID` | `""` | 発注主体のエージェントプロファイル ID（監査証跡に必須） |
| `AGENT_RUNNER_PROVIDER` | `hold` | 判断プロバイダ（`hold` / `llm`） |
| `AGENT_LLM_MODEL` | `claude-opus-4-8` | 判断に用いる LLM モデル名 |
| `AGENT_RUNNER_CRON` | `0 0 * * *` | 自律ループの cron（既定 1 日 1 回） |
| `AGENT_RUNNER_MAX_ACTIONS` | `3` | 1 ループの最大発注（ORDER/CANCEL）数 |
| `AGENT_RUNNER_SCHEDULE_ENABLED` | `true` | 繰り返し登録するか（false なら consumer のみ） |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ 接続 URL |
| `ANTHROPIC_API_KEY` | `""` | 実 LLM 実装の API キー（`provider=llm` 用・秘密情報） |

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
