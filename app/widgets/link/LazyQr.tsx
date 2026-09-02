// The QR code on the card — and the LOADING BOUNDARY that keeps the encoder
// out of the app's main bundle.
//
// ── The one rule this file exists to hold ──────────────────────────────────
//
// `qr-core.ts` is reached ONLY through the `import("./qr-core")` below. A
// static `import { qrMatrix } from "./qr-core"` anywhere — here, in
// LinkWidget, in a barrel file — melts the whole encoder into the index
// chunk, which every teacher loads on every boot whether or not she owns a
// link widget. Vite gives a dynamic import its own `dist/assets/qr-core-*.js`
// exactly the way `app/lib/i18n.ts:21` gives `en.json` one, and
// `scripts/check-bundle-budget.mjs` is what notices if that stops being true:
// the chunk counts in the dist TOTAL, never in the largest single JS file.
//
// The promise is cached module-globally, so a board with four link widgets
// fetches the chunk once and the other three get the resolved module.

import { useEffect, useState } from "preact/hooks";

import styles from "./link.module.css";

/** The encoder's shape, WITHOUT importing it: `typeof import()` in a type
 *  position is erased before any bundler sees it. */
type QrCore = typeof import("./qr-core");

let pending: Promise<QrCore> | null = null;

function loadQrCore(): Promise<QrCore> {
  pending ??= import("./qr-core");
  return pending;
}

/** What one finished code needs to render: the path, and the module count
 *  that sets the viewBox. */
interface Drawn {
  d: string;
  modules: number;
}

/**
 * A scannable code for `url`, or nothing at all.
 *
 * NOTHING is the deliberate answer for every failure — an address too long
 * for v10, a chunk that would not load. The caller has already decided the
 * URL is presentable and short enough (`fitsInQr`, which measures without
 * loading this), and it draws the «for lang for en QR-kode» hint itself. A
 * placeholder plate here would put a shape on the projector that a class
 * reads as «something to scan», when there is not.
 */
export function LazyQr({ url }: { url: string }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useEffect(() => {
    let live = true;
    // Trim before encoding, for the same reason Rust trims before opening:
    // the code must carry the address the teacher's click opens, and a
    // pasted URL arrives with whatever whitespace her selection caught. It
    // also keeps this side's byte count identical to the one `fitsInQr`
    // measured on the eager side — untrimmed, a URL could pass the widget's
    // capacity check and then fall out of the encoder as `null`, and the
    // board would show neither a code nor the hint that explains why.
    const payload = url.trim();
    setDrawn(null);

    loadQrCore()
      .then(({ qrMatrix, qrSvgPath }) => {
        if (!live) return;
        const matrix = qrMatrix(payload);
        setDrawn(
          matrix ? { d: qrSvgPath(matrix), modules: matrix.length } : null,
        );
      })
      .catch((e: unknown) => {
        // A chunk that will not load is a broken install, not a broken link.
        // It is logged where a developer looks and shows nothing where a
        // class looks; the widget's click surface is untouched either way.
        console.warn("[link] QR encoder failed to load", e);
        if (live) setDrawn(null);
      });

    return () => {
      live = false;
    };
  }, [url]);

  if (!drawn) return null;

  // The four-module quiet zone is the negative viewBox origin: the path is
  // drawn at 0…modules, and the box starts four units before it and runs four
  // past. One expression, impossible to add on one side and forget on the
  // other — and a scanner needs that margin as much as it needs the modules.
  const box = drawn.modules + 8;

  return (
    <svg
      class={styles.qr}
      data-qr
      viewBox={`-4 -4 ${box} ${box}`}
      // Decorative to a screen reader: the code carries the same address the
      // click surface already announces by name and host, so reading it out
      // as an image would add a second, worse copy of what is already there.
      aria-hidden="true"
      focusable="false"
    >
      {/* The light plate UNDER the modules, quiet zone included. Every widget
          card keeps `--surface` today, so this is invisible — that is the
          point: a scanner needs dark-on-light, and this makes it a property
          of the code rather than of whatever the card happens to sit on. */}
      <rect class={styles.qrPlate} x={-4} y={-4} width={box} height={box} />
      <path class={styles.qrModules} d={drawn.d} />
    </svg>
  );
}
