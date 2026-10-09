import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
export default defineConfig([
  globalIgnores([
    ".next/**",
    "artifacts/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{tsx,jsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 3 },
      ],
    },
  },
]);
