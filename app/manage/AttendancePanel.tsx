// «Hvem er her i dag?» — the class list as clickable chips, dimmed = away.
//
// A full-screen dialog on the ManagePanel/PlannerPanel pattern: scrim, panel,
// one «Lukk». It is still a two-second job at the start of a lesson, so every
// pupil is one tap, there is NO save button, and each tap is one write that
// REJECTS on failure (promise 4) — a chip that dims is a row that landed.
//
// It briefly lived as a popover anchored in the class switcher, with a local
// Escape listener and a `chromeActivity` keepalive to paper over what that
// cost. Both are gone: the SHELL mounts it (`attendancePanelOpen`), Escape
// goes through the one chain in `screen/keyboard.ts`, and `state/chrome.ts`
// holds the toolbar open while it is up.
//
// Today's only workaround for an absent pupil is to delete her name and paste
// it back, which drops her id in `replace_members` and RESETS her no-repeat
// round. This panel is that workaround's replacement.

import { useState } from "preact/hooks";

import { t, tn } from "../i18n";
import { localDateStr } from "../planner/date-core";
import { classMenuOpen, members } from "../state/classes";
import { attendancePanelOpen, presentOn, setAway } from "../state/attendance";
import { Icon } from "../ui/Icon";
import styles from "./AttendancePanel.module.css";

export function AttendancePanel() {
  const [failed, setFailed] = useState(false);
  // Minted per render, like every other `today` in the frontend (ADR-009: JS
  // owns the wall clock). No new date helper: `localDateStr(new Date())` is
  // the one spelling, in the widgets and in `state/attendance.ts` too.
  const today = localDateStr(new Date());
  const pool = members.value;
  const present = presentOn(pool, today);

  // Escape is handled centrally (screen/keyboard.ts): text field first, then
  // the class menu, then this panel, then fullscreen — one layer per press.

  const toggle = (memberId: string, away: boolean) => {
    setFailed(false);
    setAway(memberId, !away).catch((e) => {
      console.warn("[attendance] write failed", e);
      setFailed(true);
    });
  };

  return (
    <div class={styles.scrim}>
      <section class={styles.panel} aria-label={t("attendance.title")}>
        <header class={styles.header}>
          <h2 class={styles.title}>{t("attendance.title")}</h2>
          <button
            class={styles.close}
            aria-label={t("manage.close")}
            onClick={() => {
              attendancePanelOpen.value = false;
            }}
          >
            <Icon name="close" size="md" />
          </button>
        </header>

        {failed && <p class={styles.error}>{t("manage.actionFailed")}</p>}

        {pool.length === 0 ? (
          <p class={styles.empty}>{t("widget.noNames")}</p>
        ) : (
          <>
            <p class={styles.hint}>{t("attendance.hint")}</p>
            <ul class={styles.chips}>
              {pool.map((m) => {
                const away = m.absentOn === today;
                return (
                  <li key={m.id}>
                    <button
                      class={styles.chip}
                      data-away={away || undefined}
                      aria-pressed={away}
                      title={away ? t("attendance.away") : t("attendance.here")}
                      onClick={() => toggle(m.id, away)}
                    >
                      {m.name}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p class={styles.count}>
              {tn("attendance.presentCount", present.length, {
                total: pool.length,
              })}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** Open the panel from a menu: the class list closes behind it. */
export function openAttendanceFromMenu(): void {
  classMenuOpen.value = false;
  attendancePanelOpen.value = true;
}
