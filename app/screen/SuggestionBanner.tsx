// The lesson-start banner: «Neste: 7B · Norsk 08:30 → Bytt skjerm». It only
// RENDERS the suggestion — pointers move on the click (or the opt-in
// auto-switch in state/planner.ts), never from rendering.

import { t } from "../i18n";
import { formatMin } from "../planner/date-core";
import { designSession } from "../state/design-session";
import { currentSuggestion, dismissedSuggestionKey } from "../state/planner";
import { switchLesson } from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import styles from "./SuggestionBanner.module.css";

export function SuggestionBanner() {
  // Not while a screen is being designed. The banner rides at `--z-toast`,
  // ABOVE the planner's scrim, so «Bytt skjerm» would be sitting on top of the
  // design panel — one click on a board that is not the board, and
  // `switchLesson` would swap the globals out from under the borrow.
  //
  // Hidden rather than disabled: the suggestion is still true, and it comes
  // straight back the moment the session ends (its window is derived from the
  // clock, and «Ikke nå» is the only thing that settles it). A greyed-out
  // banner would say the offer had expired, which is not what happened.
  if (designSession.value) return null;
  const s = currentSuggestion.value;
  if (!s) return null;

  return (
    <div class={styles.banner} data-status="suggestion">
      <Icon name="planner" size="sm" class={styles.icon} />
      <span class={styles.text}>
        {s.running ? t("suggest.now") : t("suggest.next")} <b>{s.className}</b>{" "}
        · {s.label} {formatMin(s.startMin)}
      </span>
      <button
        class={styles.switchBtn}
        onClick={() =>
          void switchLesson(s.classId, s.sceneId).catch((e) => {
            console.warn("[banner] switch failed", e);
            toast("error", t("manage.actionFailed"));
          })
        }
      >
        {t("suggest.switch")}
      </button>
      <button
        class={styles.dismissBtn}
        onClick={() => {
          dismissedSuggestionKey.value = s.key;
        }}
      >
        {t("suggest.dismiss")}
      </button>
    </div>
  );
}
