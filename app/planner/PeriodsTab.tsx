// «Timeoppsett» — the school day's period template, defined once and applied
// Mon–Fri. Split out of PlannerPanel.tsx verbatim (R7 kodehelse #2).

import { useState } from "preact/hooks";

import type { Period } from "../bindings/Period";
import type { PeriodKind } from "../bindings/PeriodKind";
import { t, tf } from "../i18n";
import { periods, plannerChanged } from "../state/planner";
import { settings } from "../state/settings";
import { toast } from "../ui/toast";
import { Icon } from "../ui/Icon";
import { LIMITS } from "@lib/limits.generated";
import { formatMin, parseTime } from "./date-core";
import { LESSON_MINUTE_OPTIONS, ipcErrCode } from "./planner-shared";
import styles from "./PlannerPanel.module.css";

interface PeriodDraft {
  id: string | null;
  label: string;
  start: string;
  end: string;
  kind: PeriodKind;
}

function draftsFrom(list: Period[]): PeriodDraft[] {
  return list.map((p) => ({
    id: p.id,
    label: p.label,
    start: formatMin(p.startMin),
    end: formatMin(p.endMin),
    kind: p.kind,
  }));
}

export function PeriodsTab() {
  const [drafts, setDrafts] = useState<PeriodDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const rows = drafts ?? draftsFrom(periods.value);

  const edit = (i: number, patch: Partial<PeriodDraft>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setDrafts(next);
    setReceipt(false);
  };

  /**
   * Append a row of `kind`. Both buttons run through here, and both rely on
   * behaviour that was ALREADY break-safe and is only verified here:
   *   - the chain takes the previous row's END whatever kind it was, so a
   *     break slots in between two lessons without a gap;
   *   - the lesson number counts LESSON rows only, so inserting a break
   *     never bumps «Time 3» to «Time 4».
   * No «suggest a normal school day» button: invented bell times that look
   * authoritative are worse than empty rows.
   */
  const addRow = (kind: PeriodKind) => {
    const last = rows[rows.length - 1];
    const start = last ? last.end : "08:30";
    const startMin = parseTime(start) ?? 510;
    // The SCHOOL's lesson length (settings.rs::lesson_minutes) — the whole
    // point of the «Timelengde» row below: pick 30/45/60 once and every
    // press of «Legg til time» spans it. Breaks stay 15; nobody schedules
    // a school around the length of a friminutt.
    const minutes = kind === "lesson" ? settings.peek().lessonMinutes : 15;
    setDrafts([
      ...rows,
      {
        id: null,
        label:
          kind === "lesson"
            ? tf("planner.defaultPeriodLabel", {
                n: String(rows.filter((r) => r.kind === "lesson").length + 1),
              })
            : t("planner.defaultBreakLabel"),
        start,
        end: formatMin(Math.min(startMin + minutes, 1439)),
        kind,
      },
    ]);
    setReceipt(false);
  };

  const save = async () => {
    setError(null);
    const specs = [];
    for (const r of rows) {
      const start = parseTime(r.start);
      const end = parseTime(r.end);
      // An empty label used to SKIP the row — and replace-all then deleted
      // the period with its whole week (F-funn F3). Refuse instead.
      if (r.label.trim() === "") {
        setError(t("planner.emptyLabel"));
        return;
      }
      if (start == null || end == null || end <= start) {
        setError(t("planner.badTime"));
        return;
      }
      specs.push({
        id: r.id,
        label: r.label.trim(),
        startMin: start,
        endMin: end,
        kind: r.kind,
      });
    }
    try {
      periods.value = await window.api.plannerPeriodsSet(specs);
      setDrafts(null);
      setReceipt(true);
      await plannerChanged();
    } catch (e) {
      console.warn("[planner] periods save failed", e);
      // The DIAGNOSIS has to match the rejection. «Timene overlapper
      // hverandre» is the ONE failure the teacher can act on by looking at
      // the clock times in front of her — and `periods_set_for` raises it as
      // `AppError::Validation`. A locked database, a degraded boot or a full
      // disk rejects here too, and telling her to go hunt for an overlap that
      // is not there costs her the five minutes before a lesson (R7 robusthet
      // L8). Everything else gets the honest generic sentence.
      setError(
        ipcErrCode(e) === "validation"
          ? t("planner.overlap")
          : t("manage.actionFailed"),
      );
    }
  };

  return (
    <div class={styles.tabBody}>
      <p class={styles.hint}>{t("planner.periodsHint")}</p>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} class={styles.periodRow}>
          <input
            class={styles.grow}
            aria-label={t("planner.label")}
            placeholder={t("planner.label")}
            value={r.label}
            maxLength={LIMITS.LABEL_MAX_CHARS}
            onInput={(e) =>
              edit(i, { label: (e.target as HTMLInputElement).value })
            }
          />
          <input
            class={styles.time}
            aria-label={t("planner.start")}
            value={r.start}
            onInput={(e) =>
              edit(i, { start: (e.target as HTMLInputElement).value })
            }
          />
          <input
            class={styles.time}
            aria-label={t("planner.end")}
            value={r.end}
            onInput={(e) =>
              edit(i, { end: (e.target as HTMLInputElement).value })
            }
          />
          <button
            class={styles.pill}
            data-current={r.kind === "lesson" || undefined}
            onClick={() =>
              edit(i, { kind: r.kind === "lesson" ? "break" : "lesson" })
            }
          >
            {r.kind === "lesson" ? t("planner.lesson") : t("planner.break")}
          </button>
          {/* «Slett» ×N is one word down a whole button list: a screen reader
              reads «Slett, Slett, Slett» and the teacher cannot tell which
              period is about to go (R7 a11y #8). The row's own name goes into
              the ACCESSIBLE name; the visible control and its tooltip are
              untouched. A row whose name has been cleared falls back to the
              bare word — «Fjern «»» would be worse than no name at all. */}
          <button
            class={styles.rowAction}
            aria-label={
              r.label.trim() === ""
                ? t("manage.delete")
                : tf("planner.removePeriodNamed", { name: r.label })
            }
            title={t("manage.delete")}
            onClick={() => {
              setDrafts(rows.filter((_, j) => j !== i));
              setReceipt(false);
            }}
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      {/* The school's lesson length — a fact about the SCHOOL, so it lives
          in settings and survives restarts, not in this editing session.
          Three offered values because Norwegian schools run 30-, 45- or
          60-minute lessons; the store itself takes any sane number
          (LESSON_MINUTES_MIN..MAX), so a school with block lessons is a
          future option away, not a schema change. Applies to NEW rows only:
          re-fitting existing times under the teacher's hands would be the
          same shape as the seed overwriting her typing. */}
      <div class={styles.lengthRow}>
        <span class={styles.lengthLabel}>
          {t("planner.lessonMinutes")}
          {/* A stored value OUTSIDE the offered three (a clamped hand-edit,
              a future version's 90) ticks no pill — and a row that then
              says nothing about what «Legg til time» will do is a label
              posing a question it refuses to answer. The odd value moves
              into the label; the offered three never repeat there. */}
          {!LESSON_MINUTE_OPTIONS.includes(settings.value.lessonMinutes) &&
            ` — ${tf("planner.minutePill", {
              n: String(settings.value.lessonMinutes),
            })}`}
        </span>
        {LESSON_MINUTE_OPTIONS.map((m) => (
          <button
            key={m}
            class={styles.pill}
            data-current={settings.value.lessonMinutes === m || undefined}
            onClick={() => {
              const prev = settings.peek();
              settings.value = { ...prev, lessonMinutes: m };
              window.api
                .saveSettings({ ...prev, lessonMinutes: m })
                .then((stored) => {
                  // Adopt the CLAMPED answer, the settingsSetWindow rule:
                  // today {30,45,60} ⊂ [MIN,MAX] makes this a no-op, but
                  // nothing guards that containment, and a signal that keeps
                  // what it sent is how the pill and the disk drift apart.
                  settings.value = stored;
                })
                .catch((err) => {
                  console.warn("[planner] lesson-length save failed", err);
                  settings.value = prev;
                  toast("error", t("manage.actionFailed"));
                });
            }}
          >
            {tf("planner.minutePill", { n: String(m) })}
          </button>
        ))}
      </div>
      <div class={styles.actions}>
        <button class={styles.secondary} onClick={() => addRow("lesson")}>
          <Icon name="plus" size="sm" />
          {t("planner.addPeriod")}
        </button>
        <button class={styles.secondary} onClick={() => addRow("break")}>
          <Icon name="plus" size="sm" />
          {t("planner.addBreak")}
        </button>
        <button class={styles.primary} onClick={() => void save()}>
          {t("planner.savePeriods")}
        </button>
        {receipt && (
          <span class={styles.receipt}>{t("manage.savedReceipt")}</span>
        )}
        {error && <span class={styles.error}>{error}</span>}
      </div>
      <label class={styles.checkRow}>
        <input
          type="checkbox"
          checked={settings.value.autoSwitchScenes}
          onChange={(e) => {
            const next = {
              ...settings.peek(),
              autoSwitchScenes: (e.target as HTMLInputElement).checked,
            };
            const prev = settings.peek();
            settings.value = next;
            window.api.saveSettings(next).catch((err) => {
              console.warn("[planner] auto-toggle save failed", err);
              settings.value = prev;
              toast("error", t("manage.actionFailed"));
            });
          }}
        />
        {t("planner.autoSwitch")}
      </label>
    </div>
  );
}
