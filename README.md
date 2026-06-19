# stonks — 株取引シミュレーター（ペーパートレード）

実際の株価データ（日米両市場）をもとに仮想資金で売買するペーパートレード Web アプリ。
個人利用・**完全ローカル・無料運用**が絶対制約。Claude（AI エージェント）自身が
シミュレーション内で売買し、その成績を測る機能を持つ。

> このリポジトリが唯一の共有元です（別PCでもここを読めば再開できます）。
> 設計の一次情報は [`docs/spec.md`](docs/spec.md)、チーム規約は [`CLAUDE.md`](CLAUDE.md)、
> 未対応の契約課題は [`docs/contracts-backlog.md`](docs/contracts-backlog.md)。

---

## プロジェクト状態（ハンドオフ）

最終更新: 2026-06-19

| フェーズ | 状態 | 内容 |
|---|---|---|
| Phase 0 | ✅ 完了 | `@stonks/contracts`（全契約・Zod・サービス IF）, `@stonks/core-domain`（Money/decimal.js, 呼値/単元, 市場カレンダー）, `@stonks/db`（Prisma 全スキーマ）, モノレポ基盤 |
| Phase 1 | ✅ 完了 | `@stonks/analytics`(指標), `@stonks/trading-engine`(注文/約定/手数料), `@stonks/portfolio`(保有/損益), `@stonks/market-data`(Finnhub/Yahoo/J-Quants/FX + フォールバック) |
| Phase 2 | 🚧 一部 | `apps/api`(NestJS 結線・REST/SSE), `packages/agent-trader`(AI 売買・リスクガード・成績評価) |
| Phase 3 | 🚧 着手 | `@stonks/backtest`(BacktestRunner) を実装（**実行検証は未了** — 下記「未検証事項」参照） |

### ⚠️ 未検証事項（最重要・他PCで最初に対応）

- **`@stonks/backtest` は実装済みだが実行検証されていない。** この実装を入れたPCは `node_modules` 未インストール環境で、`pnpm install` / typecheck / test を流せなかった。実装は `packages/contracts` を唯一の真実として契約準拠で記述し、契約遵守テスト（`backtest.contract.test.ts`）と振る舞いテスト（`runner.test.ts`）を同梱済み。**別PCで必ず `pnpm install && pnpm -r typecheck && pnpm -r test` を実行して green を確認すること。**
- それ以前（Phase 0〜2）のパッケージは過去に typecheck green・テスト多数 green を確認済み（contracts/core-domain/analytics/trading-engine/portfolio/agent-trader/market-data/api）。ただし backtest 追加後の全体再実行はまだ。

### backlog からの申し送り（`@stonks/backtest` 実装時に判明、`domain-architect` 調停対象）

実装側で契約を勝手に変えていない（CLAUDE.md §0）。以下は contracts への要検討点として記録:

1. **`BacktestMetrics` に総損益の絶対額フィールドが無い** — 現状 `totalReturn`（比率）のみ。絶対額が要るなら `totalPnl: DecimalString` 等の追加を検討。
2. **`StrategyDef.indicators` と戦略ルールの式言語の関係が契約で未定義** — 暫定で最小 DSL（`SMA(n) crossUp/crossDown SMA(m)` / `price 比較` / `always`）を backtest 内で解釈。式仕様の正式化が望ましい。
3. **バックテストのデータ供給経路が契約に無い** — ヒストリカルバーは backtest パッケージ内ポート `BacktestDataSource`（コンストラクタ注入）で供給。market-data 直 import 禁止に従い自前ポート化。
4. backtest の MARKET BUY は事前現金チェックを行わない縮退あり（trading-engine 由来）。RiskGuard 連携時に強化余地。

### ブランチ構成（現状）

- **`main` … これが最新かつ唯一のブランチ。** Phase 0〜3着手分まで全て取り込み済み。ここから再開する。
- リモートの `feat/*` / `integration/*` ブランチは**マージ後に全て削除済み**（コミットは main の履歴に残るため復元可能）。
- 作業フロー: 必ず `main` から機能ブランチ（例 `feat/xxx`）を切る。**main へ直接コミットしない**（CLAUDE.md §5）。完了したら PR → マージ → ブランチ削除。

### 次にやること（優先順）

1. **backtest の実行検証**（上記「未検証事項」）。green を確認してから次へ。
2. **`docs/contracts-backlog.md` の B1〜B4（高優先）を反映**（銘柄ID `EXCHANGE:SYMBOL` 正準化 / 読み取り IF / `Position.currency` / 入出金責務）。`domain-architect` 経由で contracts を更新し、api・各モジュールの暫定回避を解消。上記 backtest の申し送り 1〜3 もここで調停。
3. `apps/mcp-server`（MCP で手動売買）＋ api に成績/エージェント API 追加 → これで「Claude に売買させて成績を見る」が動く（agent-trader-dev）。
4. `apps/web`（成績ダッシュボード, frontend-dev）、`apps/ingestion-worker`（BullMQ 取込, market-data-dev）。
5. Phase 3 残: 信用取引・税ロット・高度チャート・自律ループ `apps/agent-runner`（agent-trader-dev）。

### 完了済み（履歴メモ）

- 全モジュール（Phase 0〜2）と `apps/api` を PR #1〜#6 経由で `main` に統合。
- PR #7 で Phase 3 着手分: `@stonks/backtest` 実装 ＋ backlog **T1（ESLint 配線統一）解消**（contracts/core-domain/analytics/trading-engine/db に共有 flat config 継承の `eslint.config.js` を配置）。

---

## 別PC / 新規環境でのセットアップ

### 前提
- Node.js 20 以上（過去に v24、本リポの直近作業機は v26 で確認）
- Docker（Postgres/Redis をローカルで動かす場合）
- Git

### 手順
```bash
# 1) クローン（main が最新）
git clone https://github.com/Orica256/stonks.git
cd stonks
# 既存クローンなら: git checkout main && git pull origin main

# 2) コミット名義（CLAUDE.md §5 の規約。クローンには含まれないので毎環境で必須）
git config user.name  "Orica256"
git config user.email "haruto.tezuka1001@gmail.com"

# 3) pnpm（PATH に無い場合は corepack 経由で実行する）
#    corepack enable に管理者権限が要る環境では、毎回この形で呼ぶ:
corepack pnpm@9.12.0 install

# 4) Prisma クライアント生成
corepack pnpm@9.12.0 --filter @stonks/db generate

# 5) 環境変数（無料運用。Yahoo はキー不要で動く）
cp .env.example .env   # 必要なら FINNHUB_API_KEY / JQUANTS_REFRESH_TOKEN を設定

# 6) ローカル DB / Redis（API を実 DB で動かす場合のみ）
docker compose up -d
```

### 検証コマンド
```bash
corepack pnpm@9.12.0 -r typecheck      # 全パッケージ型チェック
corepack pnpm@9.12.0 -r test           # 全テスト（ライブ DB 不要）
corepack pnpm@9.12.0 -r lint           # ESLint（T1 で全パッケージ配線済み）
```

> 注: テストは Postgres 無しで green になる想定（in-memory リポジトリ / モック fetch を使用）。
> 実 DB 結線は `apps/api` の Prisma バックリポジトリで、`docker compose up` 後に動かす。
> **backtest 追加後の全体再実行はまだ未確認**（上記「未検証事項」）。

---

## Git / PR 運用（この環境固有のノウハウ）

別PCで PR 作成・マージを行う際の実務メモ。

- **`gh` CLI が入っていない環境がある。** その場合は GitHub API を直接叩く。認証トークンは Git Credential Manager に保管されているものを再利用できる:
  ```bash
  printf "protocol=https\nhost=github.com\n\n" | git credential fill   # password= がトークン
  ```
  これを `Authorization: Bearer <token>` ヘッダに載せて `https://api.github.com/repos/Orica256/stonks/pulls` に POST すれば PR 作成、`/pulls/<n>/merge` に PUT でマージできる。`gh` がある環境なら `gh pr create` / `gh pr merge` でよい。
- **PR タイトル・本文・コミットに AI/Claude 由来の署名・言及を入れない**（CLAUDE.md §5。`Co-Authored-By: Claude`、`Generated with Claude Code` 等は禁止）。
- **改行コード**: Windows では `git add` 時に `LF→CRLF` 警告が出るが正常。リポジトリ内は LF 基準。
- **スタックした PR**（feature → 親feature → 統合 のような積み重ね）を一括で main に入れる場合、統合ブランチが全部を内包するなら「土台PR + 統合PR」だけマージし、内包される個別PRは「内包済み」コメントを付けてクローズすると重複を避けられる。
- マージ済みブランチは安全確認（`git merge-base --is-ancestor origin/<branch> origin/main`）の上で削除する。

---

## 並列開発（サブエージェント運用）

`.claude/agents/` に9体のサブエージェント定義（担当パッケージ境界つき）。spec §8 / §4.3 参照。

- 依存しないモジュールは**並列**で進めてよい（例: backtest と config 系は別ファイル群で競合しない）。
- 各エージェントは**自分の担当パッケージ配下のみ**編集。他パッケージや `packages/contracts` を勝手に変えない。
- **contracts の変更が必要になったら必ず `domain-architect` を経由**（並列での競合・二重定義を防ぐ）。
- 完了基準（DoD, spec §7.3）: 型チェック・lint・単体テスト green ／ 公開 IF が contracts と一致（`*.contract.test.ts` green）／ README に責務・入出力・実行手順。
- サブエージェントには git コミットや install をさせず、ファイル生成のみ任せて**親がまとめてコミット**すると競合が起きにくい（今回の運用実績）。

---

## 構成（モノレポ）
```
apps/     api(NestJS)
          [未実装: web, mcp-server, ingestion-worker, agent-runner]
packages/ contracts(契約=唯一の真実)  core-domain  db  config
          market-data  trading-engine  portfolio  analytics  agent-trader  backtest
```
詳細・依存方向・データモデル・契約は [`docs/spec.md`](docs/spec.md) を参照。

## 重要な約束ごと（抜粋。全文は CLAUDE.md）
- 契約 `packages/contracts` が唯一の真実。横依存（ドメイン同士の直接 import）禁止。
- 金額は浮動小数禁止（core-domain の Money）。時刻は UTC。
- 完全ローカル・無料運用。有料サービス/有料 API プランは採用しない（必要時はオーナーに相談）。
- コミットは `Orica256 <haruto.tezuka1001@gmail.com>` 名義。**GitHub に AI 利用の編集履歴を残さない**（Co-Authored-By 等を付けない）。
- まだ実装フェーズでない指示には設計を出して承認を待つ。勝手に実装を進めない。
