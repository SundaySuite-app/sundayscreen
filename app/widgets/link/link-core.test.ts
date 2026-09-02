import { describe, expect, it } from "vitest";

import { LIMITS } from "@lib/limits.generated";
import {
  QR_MAX_URL_BYTES,
  displayHost,
  fitsInQr,
  isPresentableUrl,
} from "./link-core";

/**
 * THE SHARED TABLE.
 *
 * Every row here also exists, with the same expected answer, in
 * `crates/sundayscreen-core/src/layout.rs::only_an_http_url_survives_the_clamp`.
 * The two implementations are separate on purpose — Rust is the security
 * boundary, this is what stops the board offering a click the backend would
 * reject — and this table is the thing that keeps them saying the same word
 * about the same string. Add a row in one place, add it in the other.
 */
const SHARED_CASES: [url: string, presentable: boolean][] = [
  // The attack the widget exists to refuse.
  ["javascript:alert(1)", false],
  ["JaVaScRiPt:alert(1)", false],
  ["  javascript:alert(1)  ", false],
  ["data:text/html;base64,PHNjcmlwdD4=", false],
  ["file:///etc/passwd", false],
  ["vbscript:msgbox(1)", false],
  // Not a scheme at all.
  ["", false],
  ["   ", false],
  ["udir.no", false],
  ["/oppgaver/kapittel-4", false],
  ["//evil.example", false],
  // A scheme with nothing behind it is not an address.
  ["http://", false],
  ["https://", false],
  // Whitespace a paste brought along.
  [" http://udir.no ", true],
  ["\thttps://udir.no\n", true],
  // A control character INSIDE the value is smuggling — the whole value goes.
  ["http://udir.no\n.evil.example", false],
  ["http://udir\r\n.no", false],
  ["http://udir\u0000.no", false],
  // Case belongs to the scheme test, never to the value.
  ["HTTPS://Udir.NO/Oppgaver", true],
  ["https://www.udir.no/laring-og-trivsel/?q=lek#start", true],
];

describe("isPresentableUrl", () => {
  for (const [url, presentable] of SHARED_CASES) {
    it(`${presentable ? "accepts" : "refuses"} ${JSON.stringify(url)}`, () => {
      expect(isPresentableUrl(url)).toBe(presentable);
    });
  }

  it("refuses a URL over the cap instead of shortening it", () => {
    // The cap CLEARS in Rust; here the equivalent is "the click surface never
    // lights up". Either way the board never presents a truncated address —
    // a cut URL is a different resource wearing the teacher's title.
    const head = "https://skole.no/";
    const atCap = head + "a".repeat(LIMITS.LINK_URL_MAX_CHARS - head.length);
    expect([...atCap].length).toBe(LIMITS.LINK_URL_MAX_CHARS);
    expect(isPresentableUrl(atCap)).toBe(true);
    expect(isPresentableUrl(atCap + "a")).toBe(false);
  });

  it("counts codepoints, not UTF-16 units", () => {
    // An emoji is ONE char to Rust and TWO to `String.length`; counting the
    // wrong unit would refuse an address Rust accepts.
    const head = "https://skole.no/";
    const tail = "😀".repeat(
      Math.floor((LIMITS.LINK_URL_MAX_CHARS - head.length) / 2),
    );
    const url = head + tail;
    expect(url.length).toBeGreaterThan([...url].length);
    expect(isPresentableUrl(url)).toBe(true);
  });
});

describe("displayHost", () => {
  it("shows the host a class can read from the back of the room", () => {
    expect(displayHost("https://www.udir.no/laring/?q=lek#a")).toBe("udir.no");
    expect(displayHost("http://udir.no")).toBe("udir.no");
    expect(displayHost("HTTPS://Udir.NO/Oppgaver")).toBe("udir.no");
    expect(displayHost("https://skole.no:8443/side")).toBe("skole.no:8443");
  });

  it("names the host that would actually open, not the userinfo in front", () => {
    // `https://udir.no@evil.example/` opens evil.example. Printing the whole
    // authority would put the trusted name on the projector.
    expect(displayHost("https://udir.no@evil.example/side")).toBe(
      "evil.example",
    );
  });

  it("is empty for anything the widget will not present", () => {
    for (const [url, presentable] of SHARED_CASES) {
      if (presentable) continue;
      expect(displayHost(url), url).toBe("");
    }
  });
});

describe("fitsInQr", () => {
  it("measures UTF-8 bytes, which is what byte-mode QR counts", () => {
    const head = "https://skole.no/";
    const atCap = head + "a".repeat(QR_MAX_URL_BYTES - head.length);
    expect(fitsInQr(atCap)).toBe(true);
    expect(fitsInQr(atCap + "a")).toBe(false);

    // «ø» is one codepoint and TWO bytes — a URL well under the cap in
    // characters can still be over it in bytes, which is the whole reason
    // this measures encoded length.
    const norwegian = head + "ø".repeat(QR_MAX_URL_BYTES);
    expect([...norwegian].length).toBeLessThan(QR_MAX_URL_BYTES * 2);
    expect(fitsInQr(norwegian)).toBe(false);
  });
});
