// «Dagens time»: the lesson's agenda on the board. Planner mode shows
// today's current (or next) lesson from the shared planner store; manual
// mode is a free-standing list in the config. The now-marker is
// clock-driven (agenda-core) with the teacher's PIN as manual override —
// the pin persists, so a restart mid-lesson restores the exact screen.

import { useEffect, useState } from "preact/hooks";

import type { AgendaItem } from "../../bindings/AgendaItem";
import type { AgendaItemSpec } from "../../bindings/AgendaItemSpec";
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
import { LIMITS } from "@lib/limits.generated";
import styles from "./agenda.module.css";

/** The backend clamps — the board must never show what a restart would
 *  drop. Generated straight from the Rust constants, so the sides cannot
 *  drift; the manual list and the planner list keep SEPARATE constants on
 *  purpose (the Rust side says so too — different storage, free to drift). */
const MANUAL_AGENDA_MAX = LIMITS.MANUAL_AGENDA_MAX_ITEMS;
const AGENDA_TEXT_MAX = LIMITS.MANUAL_AGENDA_TEXT_MAX_CHARS;
const PLANNER_AGENDA_MAX = LIMITS.AGENDA_MAX_ITEMS;

export function AgendaWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [addDraft, setAddDraft] = useState("");
  // Re-derive the marker once a minute even without store updates.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  void plannerNowMs.value; // subscribe to the 30 s planner tick
  const nowMin = minutesOfDay(new Date());
  const plan = todayPlan.value;
  const shown = shownLesson(plan, nowMin);

  // A half-typed line belongs to the LESSON it was typed under, and BOTH
  // halves of that key move while the widget stands untouched on a board: the
  // 60 s re-derive above flips `shown` the minute a lesson ends, and midnight
  // (or any planner write) swaps the date. `addDraft` lives in useState and
  // would survive both — and be committed to a lesson the teacher never had
  // in front of her. It is cleared where the key changes, not where the
  // component happens to re-render.
  //
  // The manual list has no lesson to belong to, and its draft is written into
  // the widget's own config: it keeps the EMPTY key, so a period boundary
  // ticking past a manual widget cannot wipe what someone is typing. Changing
  // the source is a key change either way, which is right — a line meant for
  // the widget must not follow the switch into the plan.
  const draftKey =
    cfg.kind === "agenda" && cfg.source !== "manual" && plan && shown
      ? `${plan.date}:${shown.entry.period.id}`
      : "";
  useEffect(() => {
    setAddDraft("");
  }, [draftKey]);

  if (cfg.kind !== "agenda") return null;

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

  // «No lesson right now» and «no timetable at all» are different days, and
  // only one of them has something the teacher can do about it.
  //
  // NOT `periods.length === 0`: that signal is filled by `refreshPlanner()`,
  // which only runs when the panel opens — at boot it is `[]` for everyone,
  // including a teacher with a full week. `resolve_day` builds one entry per
  // PERIOD regardless of weekday, so an empty entry list means the template
  // itself is empty. The `!= null` guard keeps the text from flickering
  // before the first IPC answer lands.
  const noTimetable = plan != null && plan.entries.length === 0;

  // The lesson the field writes to, captured from the render the teacher is
  // looking at — never re-derived from the clock at write time, which could
  // land the line in the NEXT lesson if she pressed Enter across a boundary.
  const periodId = shown?.entry.period.id ?? "";

  /**
   * Replace-all with one row changed. Two disciplines, both load-bearing:
   *
   *   - the list is read from the STORE at write time (`peek`), never from
   *     the render that drew the field, so a check-off that landed between
   *     the keystroke and the Enter is not undone by this write;
   *   - `todayReadFailed` blocks it outright. `planner_agenda_set` is a
   *     replace-all, and replacing the list on a plan we KNOW is stale would
   *     resurrect rows deleted in the panel — the F13 lie, on the writing
   *     side, where it costs data instead of a sentence.
   */
  const writeAgenda = (
    build: (items: AgendaItem[]) => AgendaItemSpec[],
    onFail: () => void,
  ) => {
    const at = todayPlan.peek();
    const entry = at?.entries.find((e) => e.period.id === periodId);
    if (!at || !entry || todayReadFailed.peek()) return;
    void window.api
      .plannerAgendaSet(at.date, periodId, build(entry.agenda))
      .then(plannerChanged)
      .catch((e) => {
        console.warn("[agenda] agenda write failed", e);
        toast("error", t("manage.actionFailed"));
        onFail();
      });
  };

  const readFailed = todayReadFailed.value;
  const listFull = (shown?.entry.agenda.length ?? 0) >= PLANNER_AGENDA_MAX;

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
            // A stale plan may not be REPLACED, so it may not be pruned from
            // either: the remove button is simply not there while the read is
            // failing, rather than standing dead under the mouse.
            removable={!readFailed}
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
            onRemove={(item) =>
              writeAgenda(
                (items) => items.filter((i) => i.id !== item.id).map(toSpec),
                () => undefined,
              )
            }
          />
          {shown.entry.agenda.length === 0 && (
            // A DOOR, like «ingen timeplan» further down: «planlegg timen i
            // planleggeren» was already an instruction, and the widget stands
            // in front of the class — so it opens the thing it asks for
            // (durations and messages still live there) instead of naming it.
            <button class={styles.emptyBtn} data-no-drag onClick={openPlanner}>
              {t("agenda.plan")}
            </button>
          )}
          {/*
           * The plan is no longer read-only on the board. Four activities on
           * today's lesson used to cost seven clicks and a full-screen panel
           * in front of the class; here it is the same four Enters manual
           * mode has always had — writing to the PLAN, so the panel, «Dagen i
           * dag» and tomorrow's restart all see the same line.
           */}
          <AddRow
            draft={addDraft}
            setDraft={setAddDraft}
            disabled={readFailed || listFull}
            blockedTitle={readFailed ? t("planner.readFailed") : undefined}
            onAdd={(text) =>
              writeAgenda(
                (items) => [
                  ...items.map(toSpec),
                  { id: null, text, durationMin: null, done: false },
                ],
                // The line is not lost with the write: the field took it back
                // if the teacher has not started typing the next one.
                () => setAddDraft((d) => (d === "" ? text : d)),
              )
            }
          />
        </>
      ) : readFailed ? (
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
      <AddRow
        draft={props.addDraft}
        setDraft={props.setAddDraft}
        // The backend clamps at MANUAL_AGENDA_MAX_ITEMS; letting the board
        // show a 31st line it would drop on restart is a lie (F-funn F10).
        disabled={items.length >= MANUAL_AGENDA_MAX}
        onAdd={(text) =>
          patch((list) => [
            ...list,
            { id: crypto.randomUUID(), text, durationMin: null, done: false },
          ])
        }
      />

      <SettingsRow widget={widget} />
    </div>
  );
}

/**
 * The one-line «add an activity» form, shared by both sources.
 *
 * It was manual mode's alone, which is what made the planner source
 * read-only on the board — and `AgendaSource::default()` is Planner, so
 * read-only was the mode every new widget started in. The FORM is identical
 * either way (type, Enter, gone); only what the line is written INTO differs,
 * and that is the caller's `onAdd`.
 */
function AddRow(props: {
  draft: string;
  setDraft: (v: string) => void;
  disabled: boolean;
  /** Why the field is dead, when it is not simply a full list. */
  blockedTitle?: string;
  onAdd: (text: string) => void;
}) {
  return (
    <form
      class={styles.addRow}
      data-no-drag
      onSubmit={(e) => {
        e.preventDefault();
        const text = props.draft.trim();
        if (!text || props.disabled) return;
        props.onAdd(text);
        props.setDraft("");
      }}
    >
      <input
        class={styles.addInput}
        placeholder={t("agenda.addPlaceholder")}
        aria-label={t("agenda.addPlaceholder")}
        title={props.blockedTitle}
        maxLength={AGENDA_TEXT_MAX}
        disabled={props.disabled}
        value={props.draft}
        onInput={(e) => props.setDraft((e.target as HTMLInputElement).value)}
      />
    </form>
  );
}

/** A stored item, as the replace-all wants it back. */
function toSpec(i: AgendaItem): AgendaItemSpec {
  return {
    id: i.id,
    text: i.text,
    durationMin: i.durationMin,
    done: i.done,
  };
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
