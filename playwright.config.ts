import { defineConfig, devices } from "@playwright/test";

// The BROWSER tier. Deliberately separate from `npm run check`.
//
// The unit gate is node-env-only (see vitest.config.ts), so the rendered shell
// gets its coverage here: the shell boots in a plain browser because
// `api-shim.ts` catches every rejected `invoke` and returns the caller's
// fallback — outside Tauri the UI renders complete empty states, and the
// fixture seam populates them.
//
// ## The port is a knob, not a constant
//
// Default 1433, overridable with SUNDAYSCREEN_E2E_PORT. With several git
// worktrees on one machine, whichever checkout starts Vite first owns the
// port — `--strictPort` below keeps every other checkout's run from silently
// attaching to it and reporting green about code it never loaded.
const PORT = Number(process.env.SUNDAYSCREEN_E2E_PORT ?? 1433);

export default defineConfig({
  testDir: "./e2e",

  timeout: 45_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  // One engine: the shipped shell runs in WKWebView/WebView2, neither of which
  // is Playwright-Chromium anyway — Chromium is the closest stand-in and the
  // fastest.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
