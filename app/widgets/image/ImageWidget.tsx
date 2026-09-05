// «Bilde»: a picture from the teacher's own machine, on the board.
//
// ## What the config holds, and what it does not
//
// A UUID. The bytes are a FILE beside the database, and the reasons are in
// `crates/sundayscreen-core/src/layout.rs` (the `Image` variant) and in
// `src-tauri/src/db/images.rs`. Nothing in this component ever sees a path:
// `imagePick` answers with an id, `imageLoad` takes one.
//
// ## The three states this card can honestly be in
//
//   1. NO PICTURE — `imageId === ""`. A «Velg bilde …» button, and that is
//      the whole card.
//   2. A PICTURE — the blob-cache handed back an object URL.
//   3. MISSING — there IS an id and the backend has no bytes for it. It
//      happens for real: a setup imported from another machine whose
//      pictures did not all fit in the file lands exactly here. The card
//      SAYS SO rather than drawing an empty frame, because an empty frame on
//      a projector reads as "the picture is loading" for the rest of the
//      lesson.
//
// The three are distinguished by (`imageId`, `loading`, `url`) and never
// collapsed: «no picture yet» and «the picture is gone» have different
// remedies, and telling a teacher the wrong one costs her the lesson.

import { useEffect, useState } from "preact/hooks";

import { LIMITS } from "@lib/limits.generated";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { saveNow, updateWidgetConfig } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { acquire, browserUrls, decodeStoredImage, release } from "./blob-cache";
import styles from "./image.module.css";

export function ImageWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const imageId = cfg.kind === "image" ? cfg.imageId : "";
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // One acquire per (mounted card × imageId), one release to match — the
  // cache does the refcounting and owns every `revokeObjectURL`. `imageId` is
  // the ONLY dependency: a caption edit must not drop and re-fetch 13 MiB of
  // photograph.
  useEffect(() => {
    if (!imageId) {
      setUrl(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void acquire(
      imageId,
      async () => {
        const stored = await window.api.imageLoad(imageId);
        return stored ? decodeStoredImage(stored) : null;
      },
      browserUrls,
    ).then((got) => {
      // The card may have been dragged away, or its picture swapped, while
      // the bytes were in flight. The cache has already cleaned up after
      // itself; this guard is only about not writing state into a component
      // that is gone.
      if (!alive) return;
      setUrl(got);
      setLoading(false);
    });
    return () => {
      alive = false;
      release(imageId, browserUrls);
    };
  }, [imageId]);

  if (cfg.kind !== "image") return null;

  // An arrow CONST, not a `function` declaration, and that is load-bearing:
  // a declaration is hoisted above the `cfg.kind !== "image"` guard, so TS
  // would type `cfg` as the whole union in here and the spread below would
  // not compile.
  const pick = async () => {
    try {
      const picked = await window.api.imagePick(t("image.pickDialog"));
      // `null` is the teacher closing the dialog. Not a failure, and not a
      // change either — the card stays exactly as it was.
      if (picked === null) return;
      updateWidgetConfig(widget.id, { ...cfg, imageId: picked });
      // The board is what the file records: flush at once rather than on the
      // debounce, so a quit right after the pick cannot lose the picture.
      saveNow();
    } catch (e) {
      // The shim's `imagePick` is the write form, so this already reached the
      // error ring. This is the teacher's half, and it is ONE sentence
      // naming both refusals and the LIMIT: Rust rejects for two reasons
      // (over the ceiling, not a picture) and the remedy is the same for
      // both — pick a different file. "Too big" with no number is not
      // something anyone can act on, so the number is in the sentence,
      // in whole megabytes, from the generated limit rather than by hand.
      console.warn("[image] picking a picture failed", e);
      toast(
        "error",
        tf("image.pickFailed", {
          mb: Math.round(LIMITS.IMAGE_FILE_MAX_BYTES / (1024 * 1024)),
        }),
      );
    }
  };

  const missing = !!imageId && !loading && url === null;

  return (
    <div class={styles.image}>
      {url ? (
        /* `data-fit`, never an inline `style`: an inline style WINS over
           every stylesheet rule, so the day a theme or a `@container` step
           wants a say, the override would silently lose. */
        <img
          class={styles.picture}
          data-fit={cfg.fit}
          src={url}
          alt={cfg.caption || t("image.alt")}
        />
      ) : missing ? (
        <p class={styles.missing}>{t("image.missing")}</p>
      ) : imageId ? (
        // Loading. Deliberately no placeholder frame — see the file header.
        <p class={styles.missing} aria-live="polite">
          {t("image.loading")}
        </p>
      ) : (
        <button class={styles.pick} data-no-drag onClick={() => void pick()}>
          <Icon name="image" size="md" />
          {t("image.pick")}
        </button>
      )}

      {(url || missing) && (
        <input
          class={styles.caption}
          data-no-drag
          aria-label={t("image.caption")}
          placeholder={t("image.caption")}
          value={cfg.caption}
          maxLength={LIMITS.IMAGE_CAPTION_MAX_CHARS}
          onInput={(e) =>
            updateWidgetConfig(
              widget.id,
              { ...cfg, caption: (e.target as HTMLInputElement).value },
              { debounce: true },
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") saveNow();
          }}
          onBlur={() => saveNow()}
        />
      )}

      {/* The whole row, only when there IS a picture. An empty card already
          offers the choice as its body, so a second «Velg bilde …» would be
          a card that has to be read twice — and a fit toggle with nothing to
          fit is a control that looks live and does nothing, which is the
          fabricated success this house forbids, one interaction down. */}
      {imageId && (
        <div data-settings-row data-no-drag>
          <button data-settings-btn onClick={() => void pick()}>
            {t("image.replace")}
          </button>
          {/* «Fjern bilde» is an empty id and nothing else — there is no
              delete command, and the file is collected by the boot sweep.
              Which means it is genuinely undoable until the next app start,
              and that is the honest reason it is not a confirm dialog. */}
          <button
            data-settings-btn
            onClick={() => {
              updateWidgetConfig(widget.id, { ...cfg, imageId: "" });
              saveNow();
            }}
          >
            {t("image.remove")}
          </button>
          <button
            data-settings-btn
            aria-pressed={cfg.fit === "cover"}
            data-current={cfg.fit === "cover" || undefined}
            onClick={() =>
              updateWidgetConfig(widget.id, {
                ...cfg,
                fit: cfg.fit === "cover" ? "contain" : "cover",
              })
            }
          >
            {cfg.fit === "cover" ? t("image.fitCover") : t("image.fitContain")}
          </button>
        </div>
      )}
    </div>
  );
}
