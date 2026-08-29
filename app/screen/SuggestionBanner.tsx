// The lesson-start banner: «Neste: 7B · Norsk 08:30 → Bytt skjerm». It only
// RENDERS the suggestion — pointers move on the click (or the opt-in
// auto-switch in state/planner.ts), never from rendering.

import { t } from "../i18n";
import { formatMin } from "../planner/date-core";
import { currentSuggestion, dismissedSuggestionKey } from "../state/planner";
import { switchLesson } from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import styles from "./SuggestionBanner.module.css";

export function SuggestionBanner() {
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
