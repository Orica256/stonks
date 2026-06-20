import config from "@stonks/config/eslint";

export default [
  ...config,
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
];
