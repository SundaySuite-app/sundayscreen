// «Lenke»: a titled address on the board. The teacher clicks it open on the
// projector; the pupils scan the QR on their own devices (`LazyQr`, which
// loads the encoder as its own chunk — see that file's header).
//
// ── The one rule this component exists to hold ──────────────────────────────
// There is NO `<a href>` anywhere in this card, and there never may be. The
// click surface is a `<button>` calling `window.api.linkOpen(widget.id)` — the
// ID, never the URL. Three separate reasons, all still true on the day
// somebody thinks an anchor would be tidier:
//   1. An anchor with a `javascript:` href EXECUTES in the webview. A button
//      cannot navigate anywhere.
//   2. An anchor with an http href would navigate the ONLY window the app
//      has away from the board, mid-lesson, with no way back.
//   3. The URL the OS is handed comes from the DATABASE, re-validated in
//      Rust (`commands/links.rs`), not from whatever this render happened to
//      be holding. The webview never names an address.
// `e2e/link.spec.ts` pins it: no `a[href]` inside the card.

import { useState } from "preact/hooks";

import { LIMITS } from "@lib/limits.generated";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { saveNow, updateWidgetConfig } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
// `LazyQr` is a plain import; the ENCODER behind it is not. The dynamic
// `import("./qr-core")` lives inside that component and nowhere else — see
// its file header for why a static one would undo the whole arrangement.
import { LazyQr } from "./LazyQr";
import { displayHost, fitsInQr, isPresentableUrl } from "./link-core";
import styles from "./link.module.css";

export function LinkWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [editingTitle, setEditingTitle] = useState(false);
  if (cfg.kind !== "link") return null;

  const presentable = isPresentableUrl(cfg.url);
  const host = displayHost(cfg.url);
  // The QR hint can be answered without loading the encoder — `fitsInQr`
  // measures, it does not encode (link-core.ts).
  const qrTooLong = presentable && cfg.showQr && !fitsInQr(cfg.url);
  // R6/F6. `sanitized_url` CLEARS an address it will not vouch for — by FORM,
  // never by filter (ADR-017), and that stays. What was missing was the WORD.
  // The card said «Ingen lenke satt ennå» immediately, but this input kept
  // showing what she typed for the rest of the session, so the only moment the
  // loss became visible was the next boot, and by then there was nothing left
  // to point at. Trimmed, because a field holding nothing but a space has lost
  // nothing worth reporting — `isPresentableUrl` trims before judging too.
  const urlInvalid = cfg.url.trim() !== "" && !presentable;
  // R6/F7, WCAG 2.5.3 «Label in Name»: the accessible name must CONTAIN the
  // visible text. The visible text on this button is the HOST — or, with
  // nothing to open, the «not set» line — while the name was a fixed «Åpne
  // lenken» that appeared nowhere on screen. A voice-control user could not
  // say the name of the only control the widget has.
  const openLabel = presentable
    ? `${t("link.open")} — ${host}`
    : t("link.notSet");

  return (
    <div class={styles.link}>
      {editingTitle ? (
        <input
          class={styles.titleInput}
          aria-label={t("link.titlePlaceholder")}
          placeholder={t("link.titlePlaceholder")}
          value={cfg.title}
          maxLength={LIMITS.LINK_TITLE_MAX_CHARS}
          autofocus
          data-no-drag
          onInput={(e) =>
            updateWidgetConfig(
              widget.id,
              { ...cfg, title: (e.target as HTMLInputElement).value },
              { debounce: true },
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              setEditingTitle(false);
              // The deadline's contract: a blur or a commit key flushes the
              // pending debounce, so a quit cannot eat the last keystroke.
              saveNow();
            }
          }}
          onBlur={() => {
            setEditingTitle(false);
            saveNow();
          }}
        />
      ) : (
        <button
          class={styles.title}
          data-no-drag
          onClick={() => setEditingTitle(true)}
        >
          {cfg.title || t("link.titlePlaceholder")}
        </button>
      )}

      {/* THE CLICK SURFACE. A button, never an anchor — see the file header.
          `disabled` rather than a silently-inert click: a control that looks
          live and does nothing is the fabricated success this house forbids,
          one interaction down. */}
      <button
        class={styles.open}
        data-no-drag
        data-link-open
        disabled={!presentable}
        aria-label={openLabel}
        title={openLabel}
        onClick={() => {
          if (!presentable) return;
          // The shim's `linkOpen` is the write form, so the rejection also
          // lands in the error ring («Siste IPC-feil») — this catch is the
          // teacher's half: a locked base or an OS that refuses to open a
          // browser must say so where she is looking, not only in a log.
          window.api.linkOpen(widget.id).catch((e: unknown) => {
            console.warn("[link] open failed", e);
            toast("error", t("link.openFailed"));
          });
        }}
      >
        <Icon name="link" size="md" />
        <span class={styles.host}>{presentable ? host : t("link.notSet")}</span>
      </button>

      {/* THE CODE, or nothing. Three conditions, and each one is a different
          reason there is nothing to draw: the teacher turned it off, the
          address is not one the app will present, or it is longer than a
          scannable code can carry. Only the third has something to say, and
          it says it in words — a dashed placeholder plate on a projector
          tells a class there is something to scan when there is not.
          `fitsInQr` answers the capacity question WITHOUT loading the
          encoder, which is why the hint can render while `LazyQr` is still
          fetching its chunk (and why `QR_MAX_URL_BYTES` lives in link-core
          and is imported by qr-core, never restated there). */}
      {cfg.showQr && presentable && !qrTooLong && <LazyQr url={cfg.url} />}
      {qrTooLong && <p class={styles.qrHint}>{t("link.qrTooLong")}</p>}

      {/* …and the OTHER reason the board is not showing what she expected.
          The two hints are mutually exclusive by construction — `qrTooLong`
          needs an address the app vouches for, this one needs the opposite —
          so the card never grows more than one line of prose. It says what
          WILL be kept rather than what is wrong, because the sentence has to
          be actionable from the input she is standing in. */}
      {urlInvalid && <p class={styles.urlHint}>{t("link.invalidUrl")}</p>}

      <div data-settings-row data-no-drag>
        <input
          data-settings-btn
          class={styles.urlInput}
          type="text"
          inputMode="url"
          aria-label={t("link.urlPlaceholder")}
          placeholder={t("link.urlPlaceholder")}
          value={cfg.url}
          maxLength={LIMITS.LINK_URL_MAX_CHARS}
          onInput={(e) =>
            updateWidgetConfig(
              widget.id,
              { ...cfg, url: (e.target as HTMLInputElement).value },
              { debounce: true },
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") saveNow();
          }}
          onBlur={() => saveNow()}
        />
        <button
          data-settings-btn
          aria-pressed={cfg.showQr}
          data-current={cfg.showQr || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, showQr: !cfg.showQr })
          }
        >
          {t("link.showQr")}
        </button>
      </div>
    </div>
  );
}
