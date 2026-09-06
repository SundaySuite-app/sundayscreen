// The planner: a full-screen overlay (ManagePanel pattern) with three tabs —
// Timeoppsett (the school day's period template, defined once), Ukeplan (the
// recurring weekday × period grid) and I dag (a date's overrides, agendas
// and notes). All decisions live in cores/backed commands; this file is
// forms.
//
// The three tabs live in files of their own (`PeriodsTab.tsx`, `WeekTab.tsx`,
// `DayTab.tsx`, shared helpers in `planner-shared.ts`); this one keeps the
// SHELL — the scrim, the header, the hydration gate and the design-session
// swap. The split is mechanical (R7 kodehelse #2): the R6-F10 class of bug
// lives in the seam BETWEEN the tabs, and a 1 400-line file is where a
// granskning stops reading the seam as a seam.

import { useRef } from "preact/hooks";

import { t, tDyn } from "../i18n";
import { designSession } from "../state/design-session";
import {
  closePlanner,
  plannerHydrated,
  plannerTab,
  refreshPlanner,
} from "../state/planner";
import { useDialogFocus } from "../ui/dialog-focus";
import { Icon } from "../ui/Icon";
import { DayTab } from "./DayTab";
import { DesignPanel } from "./DesignPanel";
import { PeriodsTab } from "./PeriodsTab";
import { WeekTab } from "./WeekTab";
import styles from "./PlannerPanel.module.css";

/** Mounted by the shell only while `plannerPanelOpen` — the gate used to be an
 *  early `return null` here, which ran the hooks below on the SHELL's mount
 *  instead of on the panel's. */
export function PlannerPanel() {
  const panelRef = useRef<HTMLElement>(null);
  // The keyboard comes IN when the panel opens and goes back to whatever
  // opened it when it closes; the shell makes the board behind `inert` for as
  // long as it is up. A design session lives inside this panel, so the panel
  // stays mounted across it and the keyboard is never taken from the little
  // board (ADR-016).
  useDialogFocus(panelRef);
  const tab = plannerTab.value;
  const designing = designSession.value !== null;

  return (
    <div class={styles.scrim}>
      <section
        ref={panelRef}
        class={styles.panel}
        aria-label={t("planner.title")}
      >
        <header class={styles.header}>
          <h2 class={styles.title}>{t("planner.title")}</h2>
          {/* The tabs go away while a design session runs. Not decoration: a
              tab press unmounts the body the session's `<Surface/>` lives in,
              and the board would vanish from under the teacher's hands while
              the globals are still borrowed. The spacer keeps the close button
              where it has always been. */}
          {designing ? (
            <span class={styles.spacer} />
          ) : (
            <nav class={styles.tabs}>
              {(["periods", "week", "day"] as const).map((id) => (
                <button
                  key={id}
                  class={styles.tab}
                  data-current={tab === id || undefined}
                  onClick={() => {
                    plannerTab.value = id;
                  }}
                >
                  {tDyn("planner.tab", id)}
                </button>
              ))}
            </nav>
          )}
          <button
            class={styles.close}
            aria-label={t("manage.close")}
            /* THE one door out (state/planner.ts): it exits the design session
               — flushing the design scene and handing the board back — before
               the panel goes away. Async, so a bare call would close the panel
               with the borrow still standing. */
            onClick={() => void closePlanner()}
          >
            <Icon name="close" size="md" />
          </button>
        </header>

        {/* The design panel is rendered OUTSIDE the hydration gate. A planner
            read that fails mid-session (a `refreshPlanner` retry landing on a
            dead backend) would otherwise unmount the borrowed `<Surface/>`
            and leave the teacher looking at «redigering er sperret» with the
            projector's globals still lent out. */}
        {!plannerHydrated.value && !designing ? (
          <div class={styles.blocked}>
            <p>{t("planner.blocked")}</p>
            <button
              class={styles.secondary}
              onClick={() => void refreshPlanner()}
            >
              {t("planner.retry")}
            </button>
          </div>
        ) : (
          <div class={styles.body}>
            {designing ? (
              <DesignPanel />
            ) : (
              <>
                {tab === "periods" && <PeriodsTab />}
                {tab === "week" && <WeekTab />}
                {tab === "day" && <DayTab />}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
