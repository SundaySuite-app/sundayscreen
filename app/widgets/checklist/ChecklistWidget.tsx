// «Sjekkliste»: big check-off rows on the board («Husk: matpakke-lapp …»).
// Items and their checked state live in the config — a restart restores the
// list exactly. Text edits ride the debounced save; checks save at once.

import { useState } from "preact/hooks";

import type { ChecklistItem } from "../../bindings/ChecklistItem";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { saveNow, updateWidgetConfigBy } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { addItem, removeItem, renameItem, toggleItem } from "./checklist-core";
import styles from "./checklist.module.css";

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
            <button
              class={styles.checkBtn}
              aria-label={t("checklist.check")}
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
                value={item.text}
                autofocus
                onInput={(e) =>
                  patch(
                    (items) =>
                      renameItem(
                        items,
                        item.id,
                        (e.target as HTMLInputElement).value,
                      ),
                    { debounce: true },
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    setEditingId(null);
                    saveNow();
                  }
                }}
                onBlur={() => {
                  setEditingId(null);
                  saveNow();
                }}
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
              aria-label={t("checklist.remove")}
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
          if (!text) return;
          patch((items) => addItem(items, text, crypto.randomUUID()));
          setAddDraft("");
        }}
      >
        <input
          class={styles.addInput}
          placeholder={t("checklist.addPlaceholder")}
          aria-label={t("checklist.addPlaceholder")}
          value={addDraft}
          onInput={(e) => setAddDraft((e.target as HTMLInputElement).value)}
        />
      </form>
    </div>
  );
}
