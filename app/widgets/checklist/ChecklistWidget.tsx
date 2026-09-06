// «Sjekkliste»: big check-off rows on the board («Husk: matpakke-lapp …»).
// Items and their checked state live in the config — a restart restores the
// list exactly. Text edits ride the debounced save; checks save at once.

import { useState } from "preact/hooks";

import type { ChecklistItem } from "../../bindings/ChecklistItem";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
import { updateWidgetConfigBy } from "../../state/layout";
import { commitField } from "../../ui/commit";
import { Icon } from "../../ui/Icon";
import {
  addItem,
  removeItem,
  renameItem,
  resetAll,
  toggleItem,
} from "./checklist-core";
import styles from "./checklist.module.css";

/** The authority is layout.rs' CHECKLIST_MAX_ITEMS / CHECKLIST_TEXT_MAX_CHARS
 *  (F-funn F10): the board must not show rows a restart would drop. */
const CHECKLIST_MAX = LIMITS.CHECKLIST_MAX_ITEMS;
const CHECKLIST_TEXT_MAX = LIMITS.CHECKLIST_TEXT_MAX_CHARS;

export function ChecklistWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [addDraft, setAddDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  if (cfg.kind !== "checklist") return null;

  const patch = (
    update: (items: ChecklistItem[]) => ChecklistItem[],
    opts?: { debounce?: boolean },
  ) =>
    updateWidgetConfigBy(
      widget.id,
      (c) => (c.kind === "checklist" ? { ...c, items: update(c.items) } : c),
      opts,
    );

  return (
    <div class={styles.checklist}>
      <ul class={styles.list} data-no-drag>
        {cfg.items.map((item) => (
          <li
            key={item.id}
            class={styles.item}
            data-done={item.done || undefined}
          >
            {/*
             * The row's own text is IN the accessible name (R7/a11y-funn 8).
             * Every check button in the list used to be «Merk gjort» and
             * every remove button «Fjern punkt», so a screen-reader user in
             * the button list heard the same two words N times and had no
             * way to tell which item she was about to clear. The VISIBLE
             * text is untouched — the board says nothing new; the title
             * attribute keeps the short form for the same reason (a tooltip
             * repeating the row it is sitting on is noise).
             *
             * `data-check-btn` / `data-remove-btn` are the stable hooks for
             * tests: the accessible name now varies with the content, so
             * matching on it row by row would be matching on data.
             */}
            <button
              class={styles.checkBtn}
              data-check-btn
              aria-label={tf("checklist.checkNamed", { name: item.text })}
              title={t("checklist.check")}
              aria-pressed={item.done}
              onClick={() => patch((items) => toggleItem(items, item.id))}
            >
              {item.done && <Icon name="check" size="md" />}
            </button>
            {editingId === item.id ? (
              <input
                class={styles.editInput}
                aria-label={t("checklist.addPlaceholder")}
                maxLength={CHECKLIST_TEXT_MAX}
                value={item.text}
                autofocus
                // The shared edit-in-place contract (app/ui/commit.ts).
                {...commitField({
                  write: (text, opts) =>
                    patch((items) => renameItem(items, item.id, text), opts),
                  close: () => setEditingId(null),
                })}
              />
            ) : (
              <button
                class={styles.textBtn}
                data-no-drag
                onClick={() => setEditingId(item.id)}
              >
                {item.text}
              </button>
            )}
            <button
              class={styles.removeBtn}
              data-remove-btn
              aria-label={tf("checklist.removeNamed", { name: item.text })}
              title={t("checklist.remove")}
              onClick={() => patch((items) => removeItem(items, item.id))}
            >
              <Icon name="close" size="sm" />
            </button>
          </li>
        ))}
      </ul>
      {cfg.items.length === 0 && (
        <p class={styles.empty}>{t("checklist.empty")}</p>
      )}
      <form
        class={styles.addRow}
        data-no-drag
        onSubmit={(e) => {
          e.preventDefault();
          const text = addDraft.trim();
          if (!text || cfg.items.length >= CHECKLIST_MAX) return;
          patch((items) => addItem(items, text, crypto.randomUUID()));
          setAddDraft("");
        }}
      >
        <input
          class={styles.addInput}
          placeholder={t("checklist.addPlaceholder")}
          aria-label={t("checklist.addPlaceholder")}
          maxLength={CHECKLIST_TEXT_MAX}
          disabled={cfg.items.length >= CHECKLIST_MAX}
          value={addDraft}
          onInput={(e) => setAddDraft((e.target as HTMLInputElement).value)}
        />
      </form>

      {/* No confirmation dialog: living in the hover row IS the guard — the
          button cannot be brushed by a passing sleeve, and the worst case is
          re-ticking a list, not losing one. */}
      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          class={styles.resetBtn}
          aria-label={t("checklist.resetAll")}
          title={t("checklist.resetAll")}
          disabled={!cfg.items.some((i) => i.done)}
          onClick={() => patch(resetAll)}
        >
          <Icon name="rotate" size="sm" />
        </button>
      </div>
    </div>
  );
}
