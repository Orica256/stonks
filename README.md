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

**検証**: 全9パッケージ typecheck green、テスト **138件 green**
（contracts6 / core-domain8 / analytics22 / trading-engine25 / portfolio10 / agent-trader27 / market-data34 / api6）。

### ブランチ構成
- `main` … docs のみ（初期）。統合はまだ取り込んでいない。
- **`integration/phase1`** … Phase 0〜2 を集約した**最新**。ここから再開する。
- `feat/*` … 各モジュールの個別ブランチ（履歴用）。

### 次にやること
1. `integration/phase1` を PR で `main` へ取り込む。
2. **`docs/contracts-backlog.md` の B1〜B4（高優先）を反映**（銘柄ID `EXCHANGE:SYMBOL` 正準化 / 読み取り IF / `Position.currency` / 入出金責務）。反映後、api・各モジュールの暫定回避を解消。
3. `apps/mcp-server`（MCP で手動売買）＋ api に成績/エージェント API 追加 → これで「Claude に売買させて成績を見る」が動く。
4. `apps/web`（成績ダッシュボード）、`apps/ingestion-worker`（BullMQ 取込）、ESLint 配線統一（backlog T1）。
5. Phase 3: バックテスト実装・信用取引・税ロット・自律ループ(agent-runner)。

---

## 別PC / 新規環境でのセットアップ

### 前提
- Node.js 20 以上（開発は v24 で確認）
- Docker（Postgres/Redis をローカルで動かす）
- Git

### 手順
```bash
# 1) クローンと最新ブランチ
git clone https://github.com/Orica256/stonks.git
cd stonks
git checkout integration/phase1

# 2) コミット名義（CLAUDE.md §5 の規約。クローンには含まれないので必須）
git config user.name  "Orica256"
git config user.email "haruto.tezuka1001@gmail.com"

# 3) pnpm（PATH に無い場合は corepack 経由で実行する）
#    corepack enable に管理者権限が要る環境では、毎回この形で呼ぶ:
corepack pnpm@9.12.0 install

# 4) Prisma クライアント生成
corepack pnpm@9.12.0 --filter @stonks/db generate

# 5) 環境変数（無料運用。Yahoo はキー不要で動く）
cp .env.example .env   # 必要なら FINNHUB_API_KEY / JQUANTS_REFRESH_TOKEN を設定

# 6) ローカル DB / Redis（API を実 DB で動かす場合）
docker compose up -d
```

### 検証コマンド
```bash
corepack pnpm@9.12.0 -r typecheck      # 全パッケージ型チェック
corepack pnpm@9.12.0 -r test           # 全テスト（ライブ DB 不要）
```

> 注: テストは Postgres 無しで green になります（in-memory リポジトリ / モック fetch を使用）。
> 実 DB 結線は `apps/api` の Prisma バックリポジトリで、`docker compose up` 後に動かします。

---

## 構成（モノレポ）
```
apps/   api(NestJS) [/ web, mcp-server, ingestion-worker は未実装]
packages/ contracts(契約=唯一の真実) core-domain db
          market-data trading-engine portfolio analytics agent-trader  [/ backtest 未実装]
```
詳細・依存方向・データモデル・契約は [`docs/spec.md`](docs/spec.md) を参照。

## 重要な約束ごと（抜粋。全文は CLAUDE.md）
- 契約 `packages/contracts` が唯一の真実。横依存（ドメイン同士の直接 import）禁止。
- 金額は浮動小数禁止（core-domain の Money）。時刻は UTC。
- 完全ローカル・無料運用。有料サービス/有料 API プランは採用しない。
- コミットは `Orica256 <haruto.tezuka1001@gmail.com>` 名義。**GitHub に AI 利用の編集履歴を残さない**（Co-Authored-By 等を付けない）。
