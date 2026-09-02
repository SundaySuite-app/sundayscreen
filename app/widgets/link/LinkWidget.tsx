// «Lenke»: a titled address on the board. The teacher clicks it open on the
// projector; the pupils scan the QR on their own devices (W3 draws the code —
// see the marker below).
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
        aria-label={t("link.open")}
        title={t("link.open")}
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

      {/* W3 (the QR wave) HOOKS IN HERE.
          W2 deliberately draws NOTHING where the code will go. A dashed
          placeholder plate on a projector tells a class there is something
          to scan when there is not, and «vis ikke noe du ikke har» is the
          same rule the rest of this app is built on.
          What W2 leaves ready: `showQr` is persisted and toggled below,
          `fitsInQr` answers the capacity question WITHOUT loading the
          encoder (link-core.ts, and `QR_MAX_URL_BYTES` is the number
          `qr-core.ts` must import rather than restate), and the «too long»
          hint is already live because it needs no encoder. W3's change is
          this one slot: `{cfg.showQr && presentable && !qrTooLong &&
          <LazyQr url={cfg.url} />}`, its own `.qr*` classes in
          link.module.css, and the WIDTH-based degradation beside them (the
          height rule at the bottom of that file is already in). */}
      {qrTooLong && <p class={styles.qrHint}>{t("link.qrTooLong")}</p>}

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
