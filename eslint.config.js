import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Flat config. Prettier last so formatting stays prettier's job alone.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "target/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "src/lib/bindings/**",
      "app/bindings/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The house i18n rule: `t(key)` takes exactly one argument — a fallback
      // hides a missing key behind correct Norwegian text. The i18n-keys gate
      // checks arity too; this is the editor-time half.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='t'][arguments.length>1]",
          message:
            "t(key) tar ETT argument — en fallback skjuler en manglende nøkkel (se check-i18n-keys.mjs).",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The shared inventory under app/lib keeps the legacy `t(key, fallback)`
    // loader signature (api-shim's notifier reads copy through it before the
    // shell's catalogue-backed t() is installed) — the arity rule applies to
    // the SHELL's t(), not the loader's.
    files: ["app/lib/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  prettier,
);
