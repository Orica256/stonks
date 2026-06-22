# モジュール整合性チェック（spec ↔ 実装 / モジュール間 IF）

全モジュールを横断して、**仕様（`docs/spec.md`）と実装の一致**、および**モジュール間インターフェースの食い違い**を検出する仕組み。`pnpm typecheck` や各パッケージの `*.contract.test.ts`（契約遵守テスト）では拾えない種類のズレを静的解析で補う。

## 実行

```bash
pnpm check:consistency      # 横断整合性チェックのみ（node scripts/check-consistency.mjs）
pnpm verify                 # generate → typecheck → lint → test → check:consistency（全ゲート）
```

CI では `.github/workflows/ci.yml` が push / PR ごとに `pnpm verify` を実行する。`ERROR` が 1 件でもあれば終了コード 1（ゲート不合格）。`WARNING` は合格を維持する（情報通知）。

## 検証する5観点

| 記号 | 観点 | 検出するズレ |
|---|---|---|
| **A** | クライアント ↔ API ルート | web / mcp-server / agent-runner が叩く HTTP パスに対応する `apps/api` のルートが無い（クライアント↔サーバのドリフト） |
| **B** | spec §6.8 ↔ API ルート | spec のエンドポイントが未実装（ERROR）／実装ルートが spec 未記載（WARN。§6.8 は「代表」列挙のため） |
| **C** | spec §6 IF ↔ contracts | **IF の存在**: spec §6 のモジュール IF（`MarketDataProvider` 等）が `packages/contracts` に export されているか（ERROR）。**メソッド単位の突合**: spec §6 の IF メソッドが契約の同 IF に無い＝IF 食い違い（ERROR）／契約側だけにあるメソッドは追加的・後方互換の可能性（WARN。spec 追記の検討材料） |
| **D** | 依存方向 (spec §4.3) | 各パッケージが許可外の `@stonks/*` を直接 import（横依存禁止違反） |
| **E** | IF ↔ 契約遵守テスト | spec §6 の各モジュール IF を参照する `*.contract.test.ts` が見当たらない＝契約遵守テスト未整備の可能性（WARN） |

> **C のメソッド突合**は「spec の IF にあるメソッドが契約に無い」を ERROR で検出する（IF 食い違いの一次防衛）。spec の IF 本体は波括弧対応で本体を切り出し、コメント・ネストした型リテラル `{...}` を除去してからメソッド宣言 `name(` を拾う（単一行 IF・複数行 IF の双方に対応）。`// 任意: streamQuotes(...)` のようなコメント内例示はメソッドとして数えない。

> A は「先日の `/performance` レスポンス形不一致」のようなクライアント↔サーバ齟齬の一次防衛。値（レスポンスの型）の一致は、クライアントが **contracts の型のみを使う**（D で担保）ことで型レベルに寄せている。

## ERROR と WARNING の使い分け

- **ERROR（ゲート不合格）**: 壊れている整合性。クライアントが存在しないルートを叩く（A）、spec の IF が契約に無い（C）、横依存違反（D）、spec のエンドポイント未実装（B。ただし既知保留を除く）。
- **WARNING（合格・通知のみ）**: 「実装が spec に追従中」など、設計上想定される差。実装ルートが spec §6.8 の代表一覧に無い、既知の実装保留エンドポイント等。

## 拡張・調整

`scripts/check-consistency.mjs` 内で調整する:

- **`DEP_POLICY`**: パッケージごとに許可する `@stonks/*` 依存先（spec §4.3 をコード化）。新パッケージ追加時はここに追記する（未定義パッケージは WARN で通知される）。
- **`KNOWN_PENDING`**: spec §6.8 にあるが API 実装が後続フェーズ保留のエンドポイント（現状 `backtests`。Phase 3 で実装予定）。実装したらここから外す。
- **`API_PREFIXES`**: クライアント内の API パス文字列を識別するトップレベルセグメント。

## 限界（既知）

- ルート抽出は `@Controller` / `@Get|@Post|…` デコレータの**静的解析**。動的なパス組み立てや非デコレータ経路は対象外。
- A はパスの**存在**を照合する（メソッド・レスポンス型までは見ない）。型レベルの一致は contracts 共有（D）と typecheck に委ねる。
- C のメソッド突合は**メソッド名**の集合一致を見る（引数・戻り値の型までは比較しない）。型レベルの一致は各パッケージの `*.contract.test.ts`（型代入で IF 適合を固定）と typecheck に委ねる。
- E は IF 名が `*.contract.test.ts` 本文に**現れるか**を見る（テストが実際にその IF を検証しているかまでは保証しない。型適合の固定は各テストの責務）。
- spec のパースは見出し（`### 6.8`, `## 6.` 〜 `## 7.`）と IF 表記に依存する。spec の構成や §6 の `interface` ブロック表記を変えたらパース箇所の追従が要る。
