// Proof that the plugin-free JSX transform resolves (oxc reads
// jsx/jsxImportSource from tsconfig.json) and that the shell renders both
// its states from the catalogue.

import { afterEach, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { Shell } from "./Shell";
import { hydrated } from "./state/settings";

afterEach(() => {
  hydrated.value = false;
});

it("renders the boot splash with the wordmark until settings land", () => {
  const html = render(<Shell />);
  expect(html).toContain("SundayScreen");
  expect(html).toContain('data-status="loading"');
});

it("renders the surface and toolbar once hydrated", () => {
  hydrated.value = true;
  const html = render(<Shell />);
  // The toolbar's add button carries the widget label from the catalogue.
  expect(html).toContain("Tekst");
  expect(html).toContain("SundayScreen");
  expect(html).not.toContain('data-status="loading"');
});
