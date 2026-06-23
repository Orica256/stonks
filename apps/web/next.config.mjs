/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // contracts は TS ソースを直接公開しているため Next にトランスパイルさせる。
  transpilePackages: ["@stonks/contracts"],
  // contracts は NodeNext 方式でソース内の相対 import に拡張子 `.js` を付ける
  // （例 index.ts の `export * from "./common.js"`）。webpack は `.js` を実ファイル
  // `.ts` へ自動解決しないため、runtime 値（parseInstrumentId 等）を import すると
  // 「Can't resolve './common.js'」になる。extensionAlias で `.js`→`.ts/.tsx/.js` を
  // 試行させて解決する（NodeNext の TS ソースを webpack で消費する定石）。
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
