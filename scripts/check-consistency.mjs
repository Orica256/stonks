#!/usr/bin/env node
// @ts-check
/**
 * 全モジュール横断の整合性チェック（仕様↔実装、モジュール間 IF の食い違い検出）。
 *
 * `pnpm typecheck` / `*.contract.test.ts` では拾えない種類のズレを静的に検出する:
 *   A. HTTP クライアント（web/mcp-server/agent-runner）が叩くパス ↔ 実 API ルート
 *   B. spec §6.8 のエンドポイント一覧 ↔ apps/api の実装ルート
 *   C. spec §6 のモジュール IF ↔ packages/contracts（IF の存在 + メソッド単位の突合）
 *   D. 依存方向（spec §4.3「横方向の直接 import 禁止」）の遵守
 *   E. spec §6 の各モジュール IF が契約遵守テスト（*.contract.test.ts）で覆われているか
 *
 * 仕様の一次情報は docs/spec.md（CLAUDE.md）。実装が spec から逸脱したら spec 側の
 * 更新提案を上げる前提で、ここでは「逸脱の検出」のみを担う。
 *
 * 使い方: `node scripts/check-consistency.mjs`（`pnpm check:consistency`）。
 * ERROR が 1 件でもあれば終了コード 1（CI ゲート用）。WARNING は 0 を維持する。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ level: "ERROR" | "WARN"; section: string; message: string }} Finding */
/** @type {Finding[]} */
const findings = [];
const err = (section, message) => findings.push({ level: "ERROR", section, message });
const warn = (section, message) => findings.push({ level: "WARN", section, message });

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/** ディレクトリ配下の .ts/.tsx を再帰列挙（node_modules/dist 除外）。 */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** パスを正準形へ: `${...}`/`:id` をプレースホルダ化、前後スラッシュ・クエリ除去、小文字化。 */
function canonPath(p) {
  return p
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":p")
    .replace(/\?.*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// API の実ルートを抽出（@Controller のベース + メソッドデコレータのパス）
// ─────────────────────────────────────────────────────────────

/** @returns {{ method: string; path: string; raw: string; file: string }[]} */
function collectApiRoutes() {
  const routes = [];
  for (const file of walk(join(ROOT, "apps/api/src")).filter((f) =>
    f.endsWith(".controller.ts"),
  )) {
    const src = readFileSync(file, "utf8");
    const baseMatch = src.match(/@Controller\(\s*["'`]([^"'`]*)["'`]\s*\)/);
    const base = baseMatch ? baseMatch[1] : "";
    const re = /@(Get|Post|Put|Delete|Patch|Sse)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      const sub = m[2] ?? "";
      const full = canonPath(`${base}/${sub}`);
      routes.push({ method, path: full, raw: `${method} /${full}`, file: rel(file) });
    }
  }
  return routes;
}

// ─────────────────────────────────────────────────────────────
// A. HTTP クライアントのパス ↔ 実 API ルート
// ─────────────────────────────────────────────────────────────

/** API 面のトップレベルセグメント（クライアント内の API パス文字列を識別）。 */
const API_PREFIXES = ["instruments", "accounts", "orders", "agents", "quotes", "backtests"];

/** クライアント側ファイルから API パス文字列を抽出（コメント行は除外）。 */
function collectClientPaths(globDirs) {
  /** @type {{ path: string; file: string; line: number }[]} */
  const calls = [];
  for (const dir of globDirs) {
    for (const file of walk(join(ROOT, dir))) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // JSDoc/コメント行（`/** … */` 単行・`* …`・`// …`）の例示パスは拾わない。
        if (
          trimmed.startsWith("*") ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*")
        )
          return;
        const re = /["'`](\/[A-Za-z0-9_${}().:/-]*)["'`]/g;
        let m;
        while ((m = re.exec(line)) !== null) {
          const raw = m[1];
          const canon = canonPath(raw);
          const head = canon.split("/")[0];
          if (API_PREFIXES.includes(head)) {
            calls.push({ path: canon, file: rel(file), line: i + 1 });
          }
        }
      });
    }
  }
  return calls;
}

function checkClientServerParity(routes) {
  const routePaths = new Set(routes.map((r) => r.path));
  const clients = collectClientPaths([
    "apps/web/src/lib/api",
    "apps/mcp-server/src",
    "apps/agent-runner/src",
  ]);
  const seen = new Set();
  for (const c of clients) {
    const key = `${c.path}@${c.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!routePaths.has(c.path)) {
      err(
        "A:client↔api",
        `クライアントが叩く /${c.path} に対応する API ルートが無い（${c.file}:${c.line}）`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// B. spec §6.8 のエンドポイント ↔ 実 API ルート
// ─────────────────────────────────────────────────────────────

/** docs/spec.md の見出し region（次の同レベル見出しまで）を返す。 */
function specSection(spec, heading) {
  const start = spec.indexOf(heading);
  if (start < 0) return "";
  const after = spec.slice(start + heading.length);
  const next = after.search(/\n###?\s/);
  return next < 0 ? after : after.slice(0, next);
}

/** spec §6.8 に載るが API 実装が後続フェーズ保留のエンドポイント（既知ギャップ）。 */
const KNOWN_PENDING = new Set([]); // POST /backtests は Phase 3 で実装済み（保留解除）

function checkSpecEndpoints(spec, routes) {
  const region = specSection(spec, "### 6.8");
  const routePaths = new Set(routes.map((r) => r.path));
  const specPaths = new Set();
  const re = /^\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/gm;
  let m;
  while ((m = re.exec(region)) !== null) {
    const path = canonPath(m[2]);
    specPaths.add(path);
    if (!routePaths.has(path)) {
      if (KNOWN_PENDING.has(path)) {
        warn("B:spec↔api", `spec §6.8 ${m[1]} /${path} は API 未実装（既知の実装保留: Phase 3）`);
      } else {
        err("B:spec↔api", `spec §6.8 のエンドポイント ${m[1]} /${path} が apps/api に未実装`);
      }
    }
  }
  // 実装あって spec に無いものは WARN（意図的な内部用もあるため）。
  for (const r of routes) {
    if (!specPaths.has(r.path)) {
      warn("B:spec↔api", `API ルート ${r.raw} が spec §6.8 に未記載（${r.file}）`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// C. spec §6 のモジュール IF ↔ contracts（IF の存在 + メソッド単位の突合）
// ─────────────────────────────────────────────────────────────

/**
 * テキストから `interface Name { ... }` を抽出し、name → メソッド名集合を返す。
 * 波括弧の対応で本体を切り出し、本体内の各行頭メソッド宣言 `name(` / `name?(`
 * を拾う（プロパティ・コメント・ネストした型リテラルの行は `(` を伴わないため除外）。
 * @param {string} text @returns {Map<string, Set<string>>}
 */
function extractInterfaces(text) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const re = /\binterface\s+([A-Z]\w+)\s*(?:extends[^{]*)?\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let depth = 0;
    let body = "";
    let i = re.lastIndex - 1; // 本体開き波括弧の位置
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
      // 外側 IF の波括弧自体は含めず、本体だけを集める（単一行 IF も扱える）。
      if (depth >= 1 && !(depth === 1 && ch === "{")) body += ch;
    }
    // コメント（例示の `// streamQuotes(...)`）とネストした型リテラル `{...}`
    // （引数/戻り値のオブジェクト型）を除去してから、メソッド宣言 `name(` を拾う。
    let cleaned = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    let prevLen;
    do {
      prevLen = cleaned.length;
      cleaned = cleaned.replace(/\{[^{}]*\}/g, " ");
    } while (cleaned.length !== prevLen);
    const methods = new Set();
    const mre = /(\w+)\??\s*\(/g;
    let mm;
    while ((mm = mre.exec(cleaned)) !== null) methods.add(mm[1]);
    // 既出（同名 IF が複数ファイルに分散することは無い想定だが）はメソッドを合算。
    const prev = map.get(name);
    if (prev) for (const x of methods) prev.add(x);
    else map.set(name, methods);
  }
  return map;
}

/** §6 全体（## 6. 〜 ## 7. 直前）の本文を返す。 */
function specSixRegion(spec) {
  const start = spec.indexOf("## 6. ");
  const end = spec.indexOf("## 7. ");
  return start >= 0 && end > start ? spec.slice(start, end) : "";
}

function checkContractInterfaces(spec) {
  const specIfs = extractInterfaces(specSixRegion(spec));

  // contracts の interface（メソッド付き）と全 export 名を収集。
  const contractIfs = new Map();
  const exported = new Set();
  for (const file of walk(join(ROOT, "packages/contracts/src"))) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const [n, methods] of extractInterfaces(src)) {
      const prev = contractIfs.get(n);
      if (prev) for (const x of methods) prev.add(x);
      else contractIfs.set(n, methods);
    }
    let e;
    const er = /export\s+(?:interface|type|const)\s+([A-Za-z_]\w*)/g;
    while ((e = er.exec(src)) !== null) exported.add(e[1]);
  }

  for (const [name, specMethods] of specIfs) {
    // C-1: IF 名の存在（contracts に export されているか）。
    if (!exported.has(name)) {
      err(
        "C:spec↔contracts",
        `spec §6 のモジュール IF \`${name}\` が packages/contracts に export されていない`,
      );
      continue;
    }
    // C-2: メソッド単位の突合。spec のメソッドが契約 IF に無ければ食い違い（ERROR）。
    const cMethods = contractIfs.get(name);
    if (!cMethods) continue; // export はあるが interface 本体未検出（型エイリアス等）。
    for (const meth of specMethods) {
      if (!cMethods.has(meth)) {
        err(
          "C:spec↔contracts",
          `spec §6 の \`${name}.${meth}()\` が packages/contracts の同 IF に無い（IF 食い違い）`,
        );
      }
    }
    // 契約側だけにあるメソッドは追加的・後方互換の可能性 → WARN（spec 追記の検討材料）。
    for (const meth of cMethods) {
      if (!specMethods.has(meth)) {
        warn(
          "C:spec↔contracts",
          `contracts の \`${name}.${meth}()\` が spec §6 に未記載（追加的・後方互換か要 spec 追記）`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// E. spec §6 の各モジュール IF が契約遵守テストで覆われているか
// ─────────────────────────────────────────────────────────────

function checkContractTestCoverage(spec) {
  const specIfs = extractInterfaces(specSixRegion(spec));
  // リポジトリ全体の *.contract.test.ts を連結（IF 名の言及を覆う/覆わないで判定）。
  let allContractTests = "";
  for (const base of ["packages", "apps"]) {
    for (const file of walk(join(ROOT, base))) {
      if (/\.contract\.test\.tsx?$/.test(file)) {
        allContractTests += readFileSync(file, "utf8") + "\n";
      }
    }
  }
  for (const name of specIfs.keys()) {
    // 単語境界で IF 名が契約テストに現れるか。
    const re = new RegExp(`\\b${name}\\b`);
    if (!re.test(allContractTests)) {
      warn(
        "E:contract-test",
        `spec §6 のモジュール IF \`${name}\` を参照する *.contract.test.ts が見当たらない（契約遵守テスト未整備の可能性）`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// D. 依存方向（spec §4.3）— 各パッケージが許可された @stonks/* のみ import
// ─────────────────────────────────────────────────────────────

/** @stonks/<name> → 許可する @stonks 依存先。"*" は全許可（合成ルート）。 */
const DEP_POLICY = {
  "@stonks/contracts": [],
  "@stonks/core-domain": ["@stonks/contracts"],
  "@stonks/db": ["@stonks/contracts"],
  "@stonks/config": [],
  "@stonks/market-data": ["@stonks/contracts", "@stonks/core-domain", "@stonks/db"],
  "@stonks/trading-engine": ["@stonks/contracts", "@stonks/core-domain"],
  "@stonks/portfolio": ["@stonks/contracts", "@stonks/core-domain", "@stonks/db"],
  "@stonks/analytics": ["@stonks/contracts", "@stonks/core-domain"],
  "@stonks/backtest": [
    "@stonks/contracts",
    "@stonks/core-domain",
    "@stonks/trading-engine",
    "@stonks/analytics",
  ],
  "@stonks/agent-trader": ["@stonks/contracts", "@stonks/core-domain"],
  "@stonks/api": "*", // 合成ルート（全モジュールを DI でマウント）
  "@stonks/mcp-server": ["@stonks/contracts"],
  "@stonks/agent-runner": ["@stonks/contracts", "@stonks/agent-trader"],
  "@stonks/ingestion-worker": [
    "@stonks/contracts",
    "@stonks/core-domain",
    "@stonks/db",
    "@stonks/market-data",
  ],
  "@stonks/web": ["@stonks/contracts"],
};

function checkDependencyDirection() {
  const dirs = [
    ...readdirSync(join(ROOT, "packages")).map((d) => join("packages", d)),
    ...readdirSync(join(ROOT, "apps")).map((d) => join("apps", d)),
  ];
  for (const pkgDir of dirs) {
    const pjPath = join(ROOT, pkgDir, "package.json");
    if (!existsSync(pjPath)) continue;
    const name = JSON.parse(readFileSync(pjPath, "utf8")).name;
    const policy = DEP_POLICY[name];
    if (policy === undefined) {
      warn("D:deps", `${name} に依存ポリシー未定義（scripts/check-consistency.mjs の DEP_POLICY に追加を）`);
      continue;
    }
    if (policy === "*") continue;
    const allowed = new Set(policy);
    for (const file of walk(join(ROOT, pkgDir, "src"))) {
      const src = readFileSync(file, "utf8");
      let m;
      // 静的 `from`、副作用 `import "x"`、動的 `import("x")`、`require("x")` を網羅。
      const re = /(?:from|import|require)\s*\(?\s*["'](@stonks\/[a-z-]+)["']/g;
      while ((m = re.exec(src)) !== null) {
        const dep = m[1];
        if (dep === name) continue;
        if (!allowed.has(dep)) {
          err(
            "D:deps",
            `${name} が ${dep} を直接 import（spec §4.3 違反。許可: ${policy.join(", ") || "なし"}）→ ${rel(file)}`,
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 実行
// ─────────────────────────────────────────────────────────────

const spec = read("docs/spec.md");
const routes = collectApiRoutes();

checkClientServerParity(routes);
checkSpecEndpoints(spec, routes);
checkContractInterfaces(spec);
checkContractTestCoverage(spec);
checkDependencyDirection();

// レポート出力
const errors = findings.filter((f) => f.level === "ERROR");
const warns = findings.filter((f) => f.level === "WARN");

console.log("── モジュール整合性チェック (spec ↔ 実装 / モジュール間 IF) ──\n");
console.log(`  API ルート検出: ${routes.length} 件`);
for (const f of findings) {
  const tag = f.level === "ERROR" ? "✗ ERROR" : "⚠ WARN ";
  console.log(`  ${tag} [${f.section}] ${f.message}`);
}
console.log(
  `\n結果: ERROR ${errors.length} 件 / WARNING ${warns.length} 件` +
    (errors.length === 0 ? "  ✅ 整合性 OK" : "  ❌ 不整合あり"),
);

process.exit(errors.length > 0 ? 1 : 0);
