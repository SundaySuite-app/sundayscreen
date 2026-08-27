// Proof that the plugin-free JSX transform resolves (oxc reads
// jsx/jsxImportSource from tsconfig.json) and that the shell renders its
// wordmark from the catalogue.

import { expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { Shell } from "./Shell";

it("Shell renders the wordmark and a status line", () => {
  const html = render(<Shell />);
  expect(html).toContain("SundayScreen");
  expect(html).toContain("data-status");
});
