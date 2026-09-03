import js from "@eslint/js";

const browserLike = {
  chrome: "readonly",
  console: "readonly",
  document: "readonly",
  window: "readonly",
  location: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Blob: "readonly",
  TextEncoder: "readonly",
  crypto: "readonly",
};

const nodeLike = {
  console: "readonly",
  process: "readonly",
  structuredClone: "readonly",
};

export default [
  {
    ignores: ["node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserLike,
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeLike,
    },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
];
