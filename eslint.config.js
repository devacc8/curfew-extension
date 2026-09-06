import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";

const browserLike = {
  chrome: "readonly",
  console: "readonly",
  document: "readonly",
  window: "readonly",
  location: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
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
    files: ["src/**/*.js", "tests/**/*.js"],
    plugins: { import: importPlugin },
    rules: {
      "import/named": "error",
      "import/no-unresolved": ["error", { caseSensitive: true }],
      "import/export": "error",
      "import/no-cycle": ["error", { maxDepth: 4 }],
      "import/no-duplicates": "error",
      "import/no-useless-path-segments": "error",
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
];
