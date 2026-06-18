# CLAUDE.md — チーム共通ルール

株取引シミュレーター（ペーパートレード）のリポジトリ。設計の全体像は **`docs/spec.md`** が一次情報。
作業前に必ず spec を確認し、矛盾を見つけたら勝手に実装せず spec 側を更新提案すること。

---

## 0. 黄金律

- **完全ローカル・無料運用が絶対制約。** アプリはローカル（PC + Docker Compose）で完結させ、有料サービス・有料 API プラン・課金前提のリアルタイム配信・従量課金クラウドを採用しない。無料枠を超える必要が出たら実装で勝手に有料化せず**必ずオーナーに相談**する（spec §1.3）。
- **契約 (`packages/contracts`) が唯一の真実。** 型・スキーマ・モジュール IF はここに集約。
  実装側で勝手に型を再定義しない。契約変更は `domain-architect` の領域。
- **モジュール横断の直接 import 禁止。** ドメイン同士は contracts のインターフェース経由でのみ結合（依存性逆転）。依存方向は spec §4.3 を厳守し、循環を作らない。
- **金額に浮動小数を使わない。** 通貨額は整数（最小単位）または Decimal 文字列。比較・加減算は `core-domain` の Money ユーティリティ経由。
- **時刻は UTC で保存・計算。** 表示時のみ市場/ローカル TZ に変換。市場の取引時間・休場日は市場カレンダーで判定。
- まだコードを書く段階でない指示のときは設計を出して**承認を待つ**。勝手に実装フェーズへ進まない。

## 1. プロジェクト構成

- pnpm workspaces + Turborepo モノレポ。`apps/*`（web, api, ingestion-worker）と `packages/*`。
- 言語は TypeScript（`strict: true`）。新規パッケージは `packages/config` の共有 tsconfig/eslint を継承。
- 詳細なディレクトリ構成は spec §4.2 を参照。

## 2. コーディング規約

- フォーマット/リントは ESLint + Prettier（`packages/config`）。コミット前に `pnpm lint` と `pnpm typecheck` が green であること。
- 命名: 型・クラスは PascalCase、変数・関数は camelCase、定数は UPPER_SNAKE。ファイルは kebab-case。
- バリデーションは Zod スキーマを契約とし、そこから型を導出（`z.infer`）。手書き型と二重管理しない。
- 公開関数・モジュール境界には JSDoc で責務と入出力を明記。
- 既存コードのスタイル（命名・コメント密度・イディオム）に合わせる。周囲から浮く書き方をしない。

## 3. テスト

- 単体テストは Vitest、E2E は Playwright。
- 各ドメインパッケージは **契約遵守テスト** (`*.contract.test.ts`) を持ち、公開 IF が contracts と一致することを保証。
- 他モジュールへの依存はフェイク/モック（contracts の IF 実装）に対してテストし、実モジュールに依存しない。
- バグ修正時は再発防止テストを先に追加。

## 4. データソース / 外部 API

- 外部株価 API は `packages/market-data` のアダプタ層の内側にのみ存在させる。他所から直接叩かない。
- API キーは `.env`（コミット禁止、`.env.example` に項目だけ記載）。レート制限を尊重し、取込は ingestion-worker（BullMQ）経由。
- 無料 API は規約・遅延・制限が変動する前提。アダプタは差し替え可能に保ち、失敗時はフォールバックチェーンで縮退。
- **採用する API・サービスは無料枠のものに限る（§0 の絶対制約）。** 有料プラン・課金前提のリアルタイム配信・従量課金サービスを選ばない。無料枠を超える要件が出たら有料化せずオーナーに相談する。

## 5. Git / コミット

- **コミット/プッシュは必ず `Orica256 <haruto.tezuka1001@gmail.com>` 名義で行う。** （`git config user.name=Orica256`, `user.email=haruto.tezuka1001@gmail.com`）
- **GitHub 上に Claude / AI 利用の編集履歴を残さない。** コミットメッセージ・本文・トレーラに `Co-Authored-By: Claude ...`、`Generated with Claude Code`、その他 AI ツール由来の署名・言及を一切含めない。`.claude/` 配下のファイル名・内容（エージェント定義等）をリポジトリに含めること自体は許可。
- コミット/プッシュはユーザの指示があるときのみ。`main` へ直接コミットしない（機能ブランチを切る。例: `feat/trading-engine-orders`）。
- コミットメッセージは Conventional Commits（`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`）。
- 1 コミット 1 関心事。フォーマットのみの変更とロジック変更を混ぜない。

## 6. 並列開発時の作法（サブエージェント向け）

- 自分の担当パッケージ（`.claude/agents/*` 参照）の境界内で作業し、他パッケージのファイルを直接編集しない。
- 他モジュールに必要な変更があれば、担当エージェント/オーナーに依頼するか contracts の変更提案として上げる。
- `contracts` の変更が必要になったら必ず `domain-architect` を経由する（並列での競合を避けるため）。
- 作業完了時は担当パッケージ README に責務・入出力・実行手順を残す。

## 7. セキュリティ / 免責

- これは投資助言ではなくシミュレーション。投資判断を促す表現を UI に入れない。免責表示を保つ。
- 実際の発注・金銭移動機能は実装しない（スコープ外）。
- 秘密情報（API キー等）をログ・コミット・クライアントバンドルに出さない。

## 8. AI エージェント取引（spec §2.7）

- Claude/LLM の売買は**シミュレーション内に限定**。実マネー・実発注（ブローカー API）には絶対に接続しない。
- 発注は TradingEngine / PortfolioService / PriceProvider の IF 経由のみ。MCP サーバー・agent-runner はドメインを直接 import せず API(HTTP) 経由で叩く。
- **全発注に rationale 付きの意思決定ログ（AgentDecision）を必ず残す**。監査証跡なしの発注を許さない。
- 自律ループは **RiskGuard（1注文/1日上限・集中度・現金チェック）と enabled フラグ・頻度上限**で暴走を防ぐ。
- 自律ループの LLM 利用料はアプリのインフラ費とは別枠（§0 のローカル・無料制約はインフラに対するもの）。頻度・モデルは設定で抑制し、デフォルトは控えめに。
- 成績評価はルックアヘッド禁止・手数料/スリッページ込み・ベンチと同条件で公正に行う。

## 9. よく使うコマンド（実装フェーズ確定後に追記）

```
pnpm install
pnpm dev          # 全アプリ開発起動（turbo）
pnpm typecheck
pnpm lint
pnpm test
docker compose up # postgres / redis
```
> 注: 上記は設計上の想定。実コマンドは scaffolding 完了後に確定・更新する。
