import { defineConfig } from "vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// One shell: `app/` is the Vite root, `dist/` (repo root) is what
// tauri.conf.json's `frontendDist: "../dist"` bundles.
//
// The port is 1433 — SundayScreen's own slot in the suite's dev-port registry
// (rec 1420, edit 1422, paper 1430, studio 1431, stage 1432). It is asserted in
// four places that must agree: here, tauri.conf.json's `devUrl` + `devCsp`,
// and playwright.config.ts.
//
// JSX is the COMPILER's, not a plugin's: `jsx: "react-jsx"` +
// `jsxImportSource: "preact"` in tsconfig.json. `@preact/preset-vite` is
// deliberately NOT used — it is a Babel plugin, and Vite 8 here is rolldown +
// oxc, so the preset is unverified on this stack. Hence `plugins: []`.
export default defineConfig({
  root: "app",
  plugins: [],

  // CSS Modules. `camelCaseOnly` means a class written `.setting-row` in CSS is
  // read as `styles.settingRow` in TSX and ONLY that — a component can never
  // quietly depend on the kebab spelling and drift from its sibling.
  css: {
    modules: { localsConvention: "camelCaseOnly" },
  },

  resolve: {
    alias: {
      // The shell's way into the shared inventory: the IPC shim and the pure
      // `*-core` modules.
      "@lib": path.resolve(__dirname, "./app/lib"),
    },
  },

  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },

  clearScreen: false,
  server: {
    port: 1433,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1434,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
