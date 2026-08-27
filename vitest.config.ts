import path from "node:path";
import { defineConfig } from "vitest/config";

// Frontend unit tests — node environment on purpose: a component that needs a
// DOM should be reduced to a pure `*-core.ts` (the house style) rather than
// dragging jsdom in. Vitest 4 runs on oxc, which reads `jsx`/`jsxImportSource`
// straight out of tsconfig.json — nothing to configure for JSX here.
export default defineConfig({
  resolve: {
    alias: {
      "@lib": path.resolve(import.meta.dirname, "./app/lib"),
    },
  },
  test: {
    environment: "node",
    // `scripts/` is release plumbing — no DOM there either, so it runs in the
    // same fast node pass and `npm run test` (and therefore CI) covers it.
    include: ["app/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
