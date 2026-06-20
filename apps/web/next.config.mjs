/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // contracts は TS ソースを直接公開しているため Next にトランスパイルさせる。
  transpilePackages: ["@stonks/contracts"],
};

export default nextConfig;
