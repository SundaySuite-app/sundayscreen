// The link widget's pure decisions: is this address one the app will present,
// and what does the board show underneath the title.
//
// `isPresentableUrl` MIRRORS the Rust rule in
// `crates/sundayscreen-core/src/layout.rs::sanitized_url` — same order, same
// four checks, and `link-core.test.ts` runs the SAME case table the Rust test
// runs so the two cannot drift apart quietly. It is not the security boundary
// (that is Rust, at the clamp and again at `link_open`); it is what stops the
// board offering a click that the backend would only reject.
//
// Where the two CAN disagree, they disagree in the safe direction: JS `trim()`
// also strips U+FEFF, which Rust's `char::is_whitespace` does not. A value
// that only JS trims into shape therefore looks presentable here and gets
// cleared there — the click rejects, and nothing opens. The reverse (Rust
// opening something this file called unpresentable) cannot happen, because
// nothing calls `link_open` unless this function said yes.

import { LIMITS } from "@lib/limits.generated";

/** Unicode category Cc — U+0000–U+001F and U+007F–U+009F — which is exactly
 *  what Rust's `char::is_control()` answers true for. A CR or LF inside a URL
 *  is smuggling, never a teacher's link. Written as a loop rather than a
 *  character-class regex so no control byte has to appear in this source. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/**
 * The longest URL that still fits in a QR code this widget will draw: QR
 * version 10, EC level L, byte mode = 271 UTF-8 bytes.
 *
 * It lives HERE, in the widget's core, rather than in the encoder, because
 * the widget has to say «for lang for en QR-kode» whether or not the encoder
 * module has been loaded yet — the QR engine is lazy (it is a separate chunk),
 * and the hint must render without pulling it in.
 *
 * ⚠️ W3 (the QR wave): `qr-core.ts` must IMPORT this constant rather than
 * restate it, and its capacity test must pin it from both sides — a URL of
 * exactly this many bytes encodes, one byte more returns `null`. Two numbers
 * for one capacity is the seam bug this house keeps finding.
 */
export const QR_MAX_URL_BYTES = 271;

/** Trim the way Rust's `str::trim()` does before judging anything — a pasted
 *  address arrives with the whitespace the teacher's selection caught. */
function clean(url: string): string {
  return url.trim();
}

/**
 * Would the app present this address — as a click surface, and as a QR code?
 *
 * The mirror of `sanitized_url`, in its order: scheme first (only `http://`
 * and `https://`, case-insensitively, and something must follow), then no
 * control characters anywhere, then the codepoint cap. Note the cap REFUSES
 * rather than shortens: a truncated URL is a different resource wearing the
 * same title.
 */
export function isPresentableUrl(url: string): boolean {
  const value = clean(url);
  if (!/^https?:\/\/./i.test(value)) return false;
  if (hasControlChar(value)) return false;
  // Codepoints, not UTF-16 units — `chars().count()` is what Rust counts.
  if ([...value].length > LIMITS.LINK_URL_MAX_CHARS) return false;
  return true;
}

/** Does the address fit in a scannable QR code? UTF-8 BYTES, which is what
 *  byte-mode QR counts — `[...s].length` would say a Norwegian «ø» costs one.
 *  Callers should ask `isPresentableUrl` first; this only measures. */
export function fitsInQr(url: string): boolean {
  return new TextEncoder().encode(clean(url)).length <= QR_MAX_URL_BYTES;
}

/**
 * The line under the title: the host, and only the host.
 *
 * A projector is read from the back of the room, so
 * `https://www.udir.no/laring-og-trivsel/rammeplan/?q=lek` becomes `udir.no`.
 * The full address is never the thing the class needs — the QR carries it,
 * and the teacher's click uses the stored value, not this string.
 *
 * Returns `""` for anything `isPresentableUrl` rejects: there is no host to
 * name, and the widget shows its "not set" line instead.
 */
export function displayHost(url: string): string {
  if (!isPresentableUrl(url)) return "";
  const value = clean(url);
  const afterScheme = value.replace(/^https?:\/\//i, "");
  // Stop at the first path, query or fragment delimiter. Deliberately NOT
  // `new URL()`: it normalises (percent-encoding, IDN → punycode, a trailing
  // slash) and would show the class an address that is not the one on the
  // card. Hosts are case-insensitive, so lowercasing is the one change made.
  const authority = afterScheme.split(/[/?#]/, 1)[0] ?? "";
  // `https://udir.no@evil.example/` is a real address whose real host is
  // `evil.example`; everything before the last `@` is userinfo. Showing the
  // whole authority would put the trusted name on the board and open the
  // other one, so the userinfo is dropped and the host stands alone.
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.toLowerCase().replace(/^www\./, "");
}
