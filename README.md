# stonks — 株取引シミュレーター（ペーパートレード）

実際の株価データ（日米両市場）をもとに仮想資金で売買するペーパートレード Web アプリ。
個人利用・**完全ローカル・無料運用**が絶対制約。Claude（AI エージェント）自身が
シミュレーション内で売買し、その成績を測る機能を持つ。

> このリポジトリが唯一の共有元です（別PCでもここを読めば再開できます）。
> 設計の一次情報は [`docs/spec.md`](docs/spec.md)、チーム規約は [`CLAUDE.md`](CLAUDE.md)、
> 未対応の契約課題は [`docs/contracts-backlog.md`](docs/contracts-backlog.md)、
> 横断整合性チェックは [`docs/consistency-check.md`](docs/consistency-check.md)。

---

## プロジェクト状態（ハンドオフ）

最終更新: 2026-06-22 ／ `main` = `origin/main` 最新。**全フェーズ＋一部拡充まで実装・検証済み。**

| フェーズ | 状態 | 内容 |
|---|---|---|
| Phase 0 | ✅ 完了 | `@stonks/contracts`（全契約・Zod・サービス IF・正準 InstrumentId・margin/tax-lot/tax 契約）, `@stonks/core-domain`（Money/decimal.js, 呼値/単元, 市場カレンダー, 税概算純関数）, `@stonks/db`（Prisma 全スキーマ＋マイグレーション）, モノレポ基盤 |
| Phase 1 | ✅ 完了 | `@stonks/analytics`(指標), `@stonks/trading-engine`(注文/約定/手数料/**信用取引**), `@stonks/portfolio`(保有/損益/**税ロット/譲渡益課税概算**), `@stonks/market-data`(Finnhub/Yahoo/J-Quants/FX + フォールバック) |
| Phase 2 | ✅ 完了 | `apps/api`(NestJS 全モジュール DI 結線・REST/SSE・agent/成績/backtest/税エンドポイント), `packages/agent-trader`(AI 売買・リスクガード・成績評価・**ベンチ比較**), `apps/mcp-server`(MCP 手動売買), `apps/ingestion-worker`(BullMQ 取込), `apps/web`(Next.js UI) |
| Phase 3 | ✅ 一部拡充 | `@stonks/backtest`(BacktestRunner・API・**web 画面**), `apps/agent-runner`(自律ループ・**実 LLM 判断**), 信用取引, 税ロット, 高度チャート(複数銘柄比較/ヒートマップ/描画ツール), **譲渡益課税概算(P1)** |

### 検証状態（最重要）

**`pnpm verify` が完全 green**（最終確認 2026-06-22, main）。これは下記を一括実行する品質ゲート:
`generate`(Prisma) → `typecheck`(全パッケージ) → `lint`(全パッケージ) → `test`(全テスト) → `check:consistency`(spec↔実装/モジュール間 IF の横断整合性)。

- テスト **341 件 green**（contracts26/core11/analytics22/web65/trading35/agent-trader34/portfolio24/market34/ingestion22/backtest4/api18/mcp17/agent-runner29）。
- 整合性チェック **ERROR 0 / WARNING 6**（WARN は「spec §6.8 の代表エンドポイント一覧に未記載の実装ルート」等の情報通知のみ。ゲートは green）。
- **再開時はまず別PCで `pnpm install && pnpm verify` を流して green を確認すること。**

### ブランチ構成（現状・すべて origin に push 済み）

- **`main` … 最新かつ唯一の正。** Phase 0〜3拡充＋譲渡益課税まで全て取り込み済み。ここから再開する。
- `integration/phase1` `integration/phase2` `integration/phase3` … 各フェーズの統合ブランチ（main にマージ済みの履歴。新規作業は不要なら触らない）。
- 作業フロー: `main`（または最新の `integration/phaseN`）から機能ブランチ（例 `feat/xxx`）を切る。**main へ直接コミットしない**（CLAUDE.md §5）。完了 → `--no-ff` マージ → push。

### 次にやること（残作業・優先順）

1. **残り P1**: 配当受取（CorporateAction DIVIDEND）・分足 OHLCV（1m/5m/15m/1h 取込）・配当/分割の調整（市場データ＋portfolio）。
2. **api 成績の理由提示**: agent-trader の `BenchmarkUnavailableError.reason`（NOT_CONFIGURED/PRICE_DATA_MISSING 等）を `/performance` レスポンスへ反映し web で表示（現状は `comparison: null` のまま）。
3. **譲渡益課税の発展**: 概算税の `CashLedger(TAX)` 現金反映タイミング、口座別非課税(NISA)の自動判定、`estimateCapitalGainsTax` optional→必須 IF 昇格（domain-architect 調整）。
4. **契約が要る Phase 3 残**: 信用の複合注文（OCO/IFD）、CASH/MARGIN 同一建玉の分離（Position 一意キー, api 要調整）。いずれも `domain-architect` 経由で契約先行。
5. backtest UI の複数銘柄ユニバース対応、E2E（Playwright）拡充。

### 主要な実装上の申し送り（詳細は `docs/contracts-backlog.md`）

- **譲渡益課税は「概算」**: 実現益×概算率（既定 `DEFAULT_CAPITAL_GAINS_TAX_RATE="0.20315"`=20.315%, 設定で差し替え可）。益のみ課税・損益通算なし・確定申告の正確計算はスコープ外（CLAUDE.md §7 免責）。spec §10 に方針追記を提案済み。
- **自律ループの実 LLM**: `apps/agent-runner` の `provider=llm` ＋ env `ANTHROPIC_API_KEY` 設定時のみ Claude(`claude-opus-4-8`)で判断。既定は無LLMの HOLD で**課金ゼロ**。LLM 利用料はインフラ費と別枠（spec §2.7）。
- **信用取引/税ロット**: contracts に margin/tax-lot 契約あり。trading-engine が信用約定・保証金・金利、portfolio が税ロット(FIFO/LIFO/AVERAGE/SPECIFIC)を実装済み。

---

## 別PC / 新規環境でのセットアップ

### 前提
- Node.js 20 以上（直近作業機は v26 で確認）。`corepack` は Node 同梱。
- Docker（Postgres/Redis をローカルで動かす場合）
- Git

### 手順
```bash
# 1) クローン（main が最新）
git clone https://github.com/Orica256/stonks.git
cd stonks
# 既存クローンなら: git checkout main && git pull origin main

# 2) コミット名義（CLAUDE.md §5。クローンには含まれないので毎環境で必須）
git config user.name  "Orica256"
git config user.email "haruto.tezuka1001@gmail.com"

# 3) pnpm は PATH に無い。必ず corepack 経由で呼ぶ（バージョン固定）
corepack pnpm@9.12.0 install

# 4) Prisma クライアント生成
corepack pnpm@9.12.0 --filter @stonks/db generate

# 5) 環境変数（無料運用。Yahoo はキー不要で動く）
cp .env.example .env
#   任意: FINNHUB_API_KEY / JQUANTS_REFRESH_TOKEN（無料枠）
#   任意: ANTHROPIC_API_KEY（agent-runner の実 LLM 判断を使う場合のみ。利用料は別枠）

# 6) ローカル DB / Redis（API を実 DB で動かす / 取込ワーカーを動かす場合のみ）
docker compose up -d
```

### 検証コマンド
```bash
corepack pnpm@9.12.0 run verify    # ★ 品質ゲート一括（generate→typecheck→lint→test→整合性）
# 個別に流す場合:
corepack pnpm@9.12.0 -r typecheck
corepack pnpm@9.12.0 -r test       # ライブ DB 不要（in-memory / モック fetch）
corepack pnpm@9.12.0 -r lint
corepack pnpm@9.12.0 run check:consistency   # spec↔実装/モジュール間 IF の横断検証のみ
```

> **ツールチェーン注意**: `pnpm` も `turbo` も PATH に無い前提。package.json スクリプト内も含め、必ず `corepack pnpm@9.12.0 ...` か `.bin`/`node` 直叩きで呼ぶ（`corepack` は Node 同梱で常に PATH 上）。
> テストは Postgres 無しで green になる（in-memory リポジトリ / モック fetch）。実 DB 結線は `apps/api` の Prisma バックリポジトリで `docker compose up` 後に動く。

### 起動（開発）
```bash
corepack pnpm@9.12.0 --filter @stonks/api start:dev        # API（既定 :3001）
corepack pnpm@9.12.0 --filter @stonks/web dev              # web（既定 :3000, API を叩く）
# mcp-server / ingestion-worker / agent-runner は各 README とエントリ参照（要 Redis/DB/任意の API キー）
```

---

## Git / PR 運用（この環境固有のノウハウ）

- **`gh` CLI が入っていない環境がある。** その場合 PR の自動作成は不可。代替: ブランチを push して GitHub の `https://github.com/Orica256/stonks/pull/new/<branch>` から手動作成するか、ローカルで `git merge --no-ff <branch>` してから `git push origin main`（本リポの直近運用はローカルマージ）。`gh` がある環境なら `gh pr create` / `gh pr merge`。
- **PR タイトル・本文・コミットに AI/Claude 由来の署名・言及を入れない**（CLAUDE.md §5。`Co-Authored-By: Claude`、`Generated with Claude Code` 等は禁止）。
- **改行コード**: Windows では `git add` 時に `LF→CRLF` 警告が出るが正常。リポジトリ内は LF 基準。
- **統合→main は `--no-ff` マージ**で行い、マージ前に main 上で `pnpm verify` green を確認、`git diff --stat <integration> main` が空（tree 一致）であることを確認してから push する。

---

## 並列開発（サブエージェント運用）

`.claude/agents/` に9体のサブエージェント定義（担当パッケージ境界つき）。spec §8 / §4.3 参照。直近は**カスタム subagent_type（agent-trader-dev / frontend-dev / domain-architect 等）を worktree 分離で並列起動**し、各エージェントが自分の worktree でコミット→親が cherry-pick / `--ff-only` で統合する運用。

- 依存しないモジュールは**並列**で進める（別パッケージ＝別ディレクトリで競合しない）。
- 各エージェントは**自分の担当パッケージ配下のみ**編集。`packages/contracts` の変更が必要になったら必ず **`domain-architect` を経由**（並列での競合・二重定義を防ぐ）。
- 完了基準（DoD, spec §7.3）: typecheck・lint・単体テスト green ／ 公開 IF が contracts と一致（`*.contract.test.ts` green）／ README に責務・入出力・実行手順。
- **★ 既知の落とし穴（再発済み）**: サブエージェントが共有 checkout（本体リポジトリ）に `cd` して `git checkout -b feat/x` 等を実行すると、**親（main ツリー）の HEAD がその feat ブランチへ移る**。以後の親の merge/cherry-pick が integration ブランチでなく feat ブランチに積まれ、integration が取り残される。**統合操作の前に必ず `git rev-parse --abbrev-ref HEAD` で正しいブランチ上か確認**。ズレたら `git branch -f integration/phaseN <feat tip>` + `git checkout` で復旧（作業は線形・無事なことが多い）。
- worktree は放置すると古い基底（main 等）から切られがち。エージェントには `git checkout -b feat/x <最新の integration ブランチ>` を明示し、`git log` で基底コミットを確認させる。

---

## 構成（モノレポ）
```
apps/     api(NestJS)  web(Next.js)  mcp-server(MCP)  ingestion-worker(BullMQ)  agent-runner(自律ループ)
packages/ contracts(契約=唯一の真実)  core-domain  db  config
          market-data  trading-engine  portfolio  analytics  agent-trader  backtest
scripts/  check-consistency.mjs(横断整合性チェック)
.github/  workflows/ci.yml(push/PR で pnpm verify)
```
詳細・依存方向・データモデル・契約は [`docs/spec.md`](docs/spec.md) を参照。

## 重要な約束ごと（抜粋。全文は CLAUDE.md）
- 契約 `packages/contracts` が唯一の真実。横依存（ドメイン同士の直接 import）禁止。`scripts/check-consistency.mjs` が依存方向・spec↔実装を検証。
- 金額は浮動小数禁止（core-domain の Money/Decimal）。時刻は UTC。
- 完全ローカル・無料運用。有料サービス/有料 API プランは採用しない（LLM 利用料のみ §2.7 で別枠・任意）。必要時はオーナーに相談。
- コミットは `Orica256 <haruto.tezuka1001@gmail.com>` 名義。**GitHub に AI 利用の編集履歴を残さない**（Co-Authored-By 等を付けない）。
- AI 売買はシミュレーション内限定・実発注/実マネー非接続。投資助言でない旨の免責を UI に保つ。
