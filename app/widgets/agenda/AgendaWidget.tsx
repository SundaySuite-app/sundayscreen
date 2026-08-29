// «Dagens time»: the lesson's agenda on the board. Planner mode shows
// today's current (or next) lesson from the shared planner store; manual
// mode is a free-standing list in the config. The now-marker is
// clock-driven (agenda-core) with the teacher's PIN as manual override —
// the pin persists, so a restart mid-lesson restores the exact screen.

import { useEffect, useState } from "preact/hooks";

import type { AgendaItem } from "../../bindings/AgendaItem";
import type { ManualAgendaItem } from "../../bindings/ManualAgendaItem";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { markedIndex, startOffsets } from "../../planner/agenda-core";
import { formatMin, minutesOfDay } from "../../planner/date-core";
import {
  openPlanner,
  plannerChanged,
  plannerNowMs,
  todayPlan,
  todayReadFailed,
} from "../../state/planner";
import { updateWidgetConfig, updateWidgetConfigBy } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { shownLesson } from "./agenda-widget-core";
import styles from "./agenda.module.css";

/** Mirrors the backend clamps in crates/sundayscreen-core/src/layout.rs —
 *  the board must never show what a restart would drop. */
const MANUAL_AGENDA_MAX = 30;
const AGENDA_TEXT_MAX = 500;

export function AgendaWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [addDraft, setAddDraft] = useState("");
  // Re-derive the marker once a minute even without store updates.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (cfg.kind !== "agenda") return null;

  void plannerNowMs.value; // subscribe to the 30 s planner tick
  const nowMin = minutesOfDay(new Date());

  if (cfg.source === "manual") {
    return (
      <ManualAgenda
        widget={widget}
        items={cfg.manualItems}
        pinned={cfg.pinnedItemId}
        showTimes={cfg.showTimes}
        addDraft={addDraft}
        setAddDraft={setAddDraft}
      />
    );
  }

  const shown = shownLesson(todayPlan.value, nowMin);
  // «No lesson right now» and «no timetable at all» are different days, and
  // only one of them has something the teacher can do about it.
  //
  // NOT `periods.length === 0`: that signal is filled by `refreshPlanner()`,
  // which only runs when the panel opens — at boot it is `[]` for everyone,
  // including a teacher with a full week. `resolve_day` builds one entry per
  // PERIOD regardless of weekday, so an empty entry list means the template
  // itself is empty. The `!= null` guard keeps the text from flickering
  // before the first IPC answer lands.
  const plan = todayPlan.value;
  const noTimetable = plan != null && plan.entries.length === 0;
  return (
    <div class={styles.agenda}>
      {shown ? (
        <>
          <header class={styles.head}>
            {!shown.current && (
              <span class={styles.nextTag}>{t("agenda.next")}</span>
            )}
            <span class={styles.title}>
              {shown.entry.lesson?.title ||
                shown.entry.lesson?.subject ||
                shown.entry.period.label}
            </span>
            <span class={styles.meta}>
              {shown.entry.lesson?.className && (
                <b>{shown.entry.lesson.className} · </b>
              )}
              {formatMin(shown.entry.period.startMin)}–
              {formatMin(shown.entry.period.endMin)}
            </span>
          </header>
          <ItemList
            items={shown.entry.agenda}
            showTimes={cfg.showTimes}
            lessonStartMin={shown.entry.period.startMin}
            minutesInto={
              shown.current ? nowMin - shown.entry.period.startMin : -1
            }
            pinned={cfg.pinnedItemId}
            onToggleDone={(item) => {
              void window.api
                .plannerAgendaCheck(item.id, !item.done)
                .then(plannerChanged)
                .catch((e) => {
                  console.warn("[agenda] check failed", e);
                  toast("error", t("manage.actionFailed"));
                });
            }}
            onPin={(item) =>
              updateWidgetConfig(widget.id, {
                ...cfg,
                pinnedItemId: cfg.pinnedItemId === item.id ? null : item.id,
              })
            }
          />
          {shown.entry.agenda.length === 0 && (
            <p class={styles.empty}>{t("agenda.plan")}</p>
          )}
        </>
      ) : todayReadFailed.value ? (
        <p class={styles.empty}>{t("planner.readFailed")}</p>
      ) : noTimetable ? (
        // A DOOR, not a message: the one thing this teacher needs is the
        // planner, and she is standing in front of the class.
        <button class={styles.emptyBtn} data-no-drag onClick={openPlanner}>
          {t("planner.noTimetable")}
        </button>
      ) : (
        <p class={styles.empty}>{t("agenda.empty")}</p>
      )}

      <SettingsRow widget={widget} />
    </div>
  );
}

function ManualAgenda(props: {
  widget: WidgetInstance;
  items: ManualAgendaItem[];
  pinned: string | null;
  showTimes: boolean;
  addDraft: string;
  setAddDraft: (v: string) => void;
}) {
  const { widget, items } = props;
  const asAgenda: AgendaItem[] = items.map((i, idx) => ({
    id: i.id,
    date: "",
    periodId: "",
    text: i.text,
    durationMin: i.durationMin,
    done: i.done,
    sortIndex: idx,
  }));

  const patch = (update: (list: ManualAgendaItem[]) => ManualAgendaItem[]) =>
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "agenda" ? { ...c, manualItems: update(c.manualItems) } : c,
    );

  return (
    <div class={styles.agenda}>
      <ItemList
        items={asAgenda}
        showTimes={props.showTimes}
        lessonStartMin={0}
        minutesInto={-1}
        pinned={props.pinned}
        removable
        onToggleDone={(item) =>
          patch((list) =>
            list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
          )
        }
        onPin={(item) =>
          updateWidgetConfigBy(widget.id, (c) =>
            c.kind === "agenda"
              ? {
                  ...c,
                  pinnedItemId: c.pinnedItemId === item.id ? null : item.id,
                }
              : c,
          )
        }
        onRemove={(item) =>
          patch((list) => list.filter((i) => i.id !== item.id))
        }
      />
      <form
        class={styles.addRow}
        data-no-drag
        onSubmit={(e) => {
          e.preventDefault();
          const text = props.addDraft.trim();
          // The backend clamps at MANUAL_AGENDA_MAX_ITEMS; letting the board
          // show a 31st line it would drop on restart is a lie (F-funn F10).
          if (!text || props.items.length >= MANUAL_AGENDA_MAX) return;
          patch((list) => [
            ...list,
            { id: crypto.randomUUID(), text, durationMin: null, done: false },
          ]);
          props.setAddDraft("");
        }}
      >
        <input
          class={styles.addInput}
          placeholder={t("agenda.addPlaceholder")}
          aria-label={t("agenda.addPlaceholder")}
          maxLength={AGENDA_TEXT_MAX}
          disabled={props.items.length >= MANUAL_AGENDA_MAX}
          value={props.addDraft}
          onInput={(e) =>
            props.setAddDraft((e.target as HTMLInputElement).value)
          }
        />
      </form>

      <SettingsRow widget={widget} />
    </div>
  );
}

function ItemList(props: {
  items: AgendaItem[];
  showTimes: boolean;
  lessonStartMin: number;
  minutesInto: number;
  pinned: string | null;
  removable?: boolean;
  onToggleDone: (item: AgendaItem) => void;
  onPin: (item: AgendaItem) => void;
  onRemove?: (item: AgendaItem) => void;
}) {
  const offsets = startOffsets(
    props.items.map((i) => ({ durationMin: i.durationMin, done: i.done })),
  );
  const marked = markedIndex(props.items, props.pinned, props.minutesInto);

  return (
    <ul class={styles.list} data-no-drag>
      {props.items.map((item, i) => (
        <li
          key={item.id}
          class={styles.item}
          data-now={i === marked || undefined}
          data-done={item.done || undefined}
        >
          {i === marked && <span class={styles.nowBar} />}
          <button
            class={styles.checkBtn}
            aria-label={t("agenda.check")}
            title={t("agenda.check")}
            aria-pressed={item.done}
            onClick={() => props.onToggleDone(item)}
          >
            {item.done && <Icon name="check" size="sm" />}
          </button>
          <button
            class={styles.textBtn}
            title={t("agenda.pin")}
            onClick={() => props.onPin(item)}
          >
            {item.text}
          </button>
          {props.showTimes && item.durationMin != null && (
            <span class={styles.time}>
              {formatMin(props.lessonStartMin + offsets[i])}
            </span>
          )}
          {props.removable && props.onRemove && (
            <button
              class={styles.removeBtn}
              aria-label={t("agenda.remove")}
              title={t("agenda.remove")}
              onClick={() => props.onRemove!(item)}
            >
              <Icon name="close" size="sm" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SettingsRow({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "agenda") return null;
  return (
    <div data-settings-row data-no-drag>
      <button
        data-settings-btn
        data-current={cfg.source === "planner" || undefined}
        onClick={() =>
          updateWidgetConfig(widget.id, { ...cfg, source: "planner" })
        }
      >
        {t("agenda.sourcePlanner")}
      </button>
      <button
        data-settings-btn
        data-current={cfg.source === "manual" || undefined}
        onClick={() =>
          updateWidgetConfig(widget.id, { ...cfg, source: "manual" })
        }
      >
        {t("agenda.sourceManual")}
      </button>
      {/* Manual items have no `durationMin` — it is always null — so start
          times cannot be derived and this button could never change what the
          board shows. A control that does nothing teaches a teacher that the
          row is unreliable. `showTimes` stays untouched in the config, so
          switching back to the planner restores her choice. */}
      {cfg.source !== "manual" && (
        <button
          data-settings-btn
          aria-pressed={cfg.showTimes}
          data-current={cfg.showTimes || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, showTimes: !cfg.showTimes })
          }
        >
          {t("agenda.showTimes")}
        </button>
      )}
    </div>
  );
}
