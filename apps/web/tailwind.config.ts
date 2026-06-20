import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 損益方向の色（投資助言ではなく可視化目的。CLAUDE.md §7）。
        gain: "#16a34a",
        loss: "#dc2626",
      },
    },
  },
  plugins: [],
};

export default config;
