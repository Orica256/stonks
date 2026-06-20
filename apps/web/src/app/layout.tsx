import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/nav";
import { Disclaimer } from "@/components/disclaimer";

export const metadata: Metadata = {
  title: "stonks — ペーパートレード",
  description:
    "仮想資金による株取引シミュレーター（ペーパートレード）。投資助言ではありません。",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="ja">
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {children}
          </main>
          <Disclaimer />
        </Providers>
      </body>
    </html>
  );
}
