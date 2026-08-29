// The one icon component. Icons are always decorative (`aria-hidden`) — the
// accessible name lives on the surrounding control's aria-label/title, which
// is what both the i18n gate and the e2e name selectors key on.

import { ICON_PATHS, ICON_STROKE_WIDTH, type IconName } from "./icon-paths";
import styles from "./Icon.module.css";

const SIZE_CLASS = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
} as const;

export type IconSize = keyof typeof SIZE_CLASS;

export function Icon(props: {
  name: IconName;
  size?: IconSize;
  class?: string;
}) {
  const paths = ICON_PATHS[props.name] as readonly string[];
  const cls = [styles.icon, SIZE_CLASS[props.size ?? "md"], props.class]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      class={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
