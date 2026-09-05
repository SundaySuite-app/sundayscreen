// GENERATED — kjør npm run limits. Do not edit by hand.
//
// Parsed by scripts/gen-limits.mjs from the `pub const` limit
// declarations in the crate files named below — THOSE are the
// authority; this file is their one TypeScript mirror. `npm run
// limits:check` (part of `npm run check`) fails the moment this file
// drifts from a fresh parse of the Rust source.

export const LIMITS = {
  // crates/sundayscreen-core/src/layout.rs
  MIN_NORM_SIZE: 0.03,
  TEXT_CONTENT_MAX_CHARS: 10000,
  FONT_SCALE_MIN: 0.25,
  FONT_SCALE_MAX: 6,
  GROUP_N_MIN: 2,
  GROUP_N_MAX: 30,
  DICE_MIN: 1,
  DICE_MAX: 3,
  PICK_N_MIN: 1,
  PICK_N_MAX: 5,
  TIMER_MIN_MS: 5000,
  TIMER_MAX_MS: 86400000,
  MANUAL_AGENDA_MAX_ITEMS: 30,
  MANUAL_AGENDA_TEXT_MAX_CHARS: 500,
  DEADLINE_TITLE_MAX_CHARS: 120,
  CHECKLIST_MAX_ITEMS: 30,
  CHECKLIST_TEXT_MAX_CHARS: 200,
  LINK_TITLE_MAX_CHARS: 120,
  LINK_URL_MAX_CHARS: 2000,
  IMAGE_FILE_MAX_BYTES: 10485760,
  IMAGE_CAPTION_MAX_CHARS: 200,

  // crates/sundayscreen-core/src/schedule.rs
  LABEL_MAX_CHARS: 80,
  TEXT_MAX_CHARS: 500,
  AGENDA_MAX_ITEMS: 30,
  AGENDA_DURATION_MIN: 1,
  AGENDA_DURATION_MAX: 600,
  NOTES_MAX: 20,

  // crates/sundayscreen-core/src/members.rs
  NAME_MAX_CHARS: 120,
  CLASS_NAME_MAX_CHARS: 80,
  MEMBERS_MAX: 1000,

  // crates/sundayscreen-core/src/settings.rs
  MIN_WINDOW_W: 960,
  MIN_WINDOW_H: 600,
  MAX_WINDOW_DIM: 20000,
  MAX_WINDOW_POS: 100000,
  LESSON_MINUTES_MIN: 5,
  LESSON_MINUTES_MAX: 240,
  LESSON_MINUTES_DEFAULT: 45,
} as const;
