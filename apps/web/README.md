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
| `/analysis` | 高度チャート（複数銘柄の正規化リターン比較・騰落率ヒートマップ・描画ツール枠） |
| `/agent` | AI エージェント成績（累積リターン/最大DD/シャープ/勝率・ベンチ比較）＋意思決定ログ（監査証跡） |

## 構成

- `src/lib/api/` — 型付き HTTP クライアント（`client.ts`）、エンドポイント（`endpoints.ts`）、TanStack Query フック（`hooks.ts`）、SSE 気配ストリーム（`quote-stream.ts`）。
- `src/features/` — 機能別 UI（instruments / chart / order）。
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
