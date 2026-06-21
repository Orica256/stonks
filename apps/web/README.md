# @stonks/web

ペーパートレード Web フロントエンド（Next.js App Router）。spec §2.3/§2.4/§2.6/§2.7 の UI を提供する。

## 責務

- apps/api（spec §6.8）の REST/SSE を叩き、銘柄検索・気配・チャート・発注・ポートフォリオ・取引履歴・AI エージェント成績/意思決定ログを表示する。
- **contracts の型のみ**を import し、ドメインパッケージは import しない（spec §4.3）。型は `@stonks/contracts` から導出し手書きしない。
- サーバ状態は TanStack Query、UI 状態（選択銘柄）は Zustand、チャートは lightweight-charts。
- 投資助言ではない旨の免責を常時表示（CLAUDE.md §7）。実発注・実マネーには接続しない。

## 画面（ルート）

| ルート | 内容 |
|---|---|
| `/` | トレード（銘柄検索＋気配＋ローソク足チャート＋注文入力） |
| `/portfolio` | 総資産サマリ＋保有ポジション（評価額・含み損益） |
| `/history` | 取引履歴（約定一覧） |
| `/analysis` | 高度チャート（複数銘柄の正規化リターン比較・騰落率ヒートマップ・描画ツール） |
| `/backtest` | バックテスト（戦略プリセット・期間・初期資金を指定し `POST /backtests` を実行、成績指標＋エクイティカーブを表示） |
| `/agent` | AI エージェント成績（累積リターン/最大DD/シャープ/勝率・ベンチ比較）＋意思決定ログ（監査証跡） |

## 構成

- `src/lib/api/` — 型付き HTTP クライアント（`client.ts`）、エンドポイント（`endpoints.ts`）、TanStack Query フック（`hooks.ts`）、SSE 気配ストリーム（`quote-stream.ts`）。
- `src/features/` — 機能別 UI（instruments / chart / order / analysis / backtest）。
- `src/features/backtest/` — バックテスト画面。対象銘柄・期間・初期資金・戦略プリセットから
  contracts の `RunBacktestRequest` を組み立て `POST /backtests`（`useRunBacktest`）を実行する。
  戦略は数個のプリセット（SMA クロス等。`lib/strategy.ts`、`when` は backtest 評価器の対応構文のみ）に限定。
  結果の整形・エクイティカーブ座標変換は純粋関数 `lib/equity.ts`（Vitest 対象）に分離し、
  描画（`equity-chart.tsx`）は lightweight-charts を `dynamic(ssr:false)` で読み込む。
- `src/features/analysis/` — 分析タブ。複数銘柄比較・ヒートマップ・**描画ツール**。
  描画ツールは単一銘柄のローソク足（既存 §6.8 `GET /instruments/:id/bars` を再利用）上に、
  クリックで**水平線（価格ライン）**と**トレンドライン（2 点の線分）**を追加・削除する
  クライアント完結の簡易作図。作図状態は Zustand（`drawing-store.ts`）、点管理・座標補間などの
  純粋ロジックは `lib/drawing.ts`（Vitest 対象）に分離。lightweight-charts は `dynamic(ssr:false)` で読み込む。
- `src/components/` — 共通 UI（Card・状態表示・ナビ・免責）。
- `src/stores/` — Zustand（選択銘柄）。
- `src/lib/format.ts` — 表示整形（金額は DecimalString を Intl で表示のみ。演算しない）。

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | apps/api のベース URL |
| `NEXT_PUBLIC_DEFAULT_ACCOUNT_ID` | `default` | 既定の口座 ID（単一ローカルユーザ前提） |

## 実行

```
corepack pnpm@9.12.0 --filter @stonks/web dev        # 開発起動（既定 :3000）
corepack pnpm@9.12.0 --filter @stonks/web build      # 本番ビルド
corepack pnpm@9.12.0 --filter @stonks/web typecheck
corepack pnpm@9.12.0 --filter @stonks/web test       # Vitest（フェイク fetch に対して）
```

## テスト方針

- API クライアントはフェイク `fetch` に対して、整形ヘルパーは純粋関数としてテストする（実 API 非依存）。
- E2E（Playwright）は後続スライスで追加予定。
