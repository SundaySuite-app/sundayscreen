// Reactive i18n for the shell.
//
// The language is a SIGNAL: a component that calls `t()` reads `locale.value`
// on the way and thereby subscribes without knowing it — when the signal
// changes, exactly those components re-render.
//
// ## The order that cannot be flipped
//
// `setLocale` loads the CATALOGUE first and flips the signal AFTER. Flipped,
// it would give one render with the new language set and the old catalogue
// loaded — the kind of one-frame bug nobody reports and nobody finds.
//
// ## No fallback arguments
//
// `t(key)`, not `t(key, "Norsk reservetekst")`. A fallback makes a missing
// key invisible: the UI reads correctly in Norwegian and goes silently
// untranslated in every other language. Enforced by ESLint (arity), the
// i18n-keys gate, and here, by the argument not existing.

import { signal } from "@preact/signals";

import {
  currentLang,
  loadLocaleCatalogue,
  t as loaderT,
  tArr as loaderTArr,
  tf as loaderTf,
  tn as loaderTn,
} from "@lib/i18n";

/** Every catalogue that exists in `app/i18n/locales/`. */
export type Locale = "no" | "en";

/** The same set, as a LIST a table test can walk. */
export const ALL_LOCALES: readonly Locale[] = ["no", "en"];

/**
 * The languages the app actually offers NOW. English is SCAFFOLDED, not
 * offered: its catalogue exists and is parity-tested (see
 * `locales/parity.test.ts`), so activating it later is this one line.
 */
export const ACTIVE_LOCALES: readonly Locale[] = ["no"];

/**
 * Which language the shell should start in, given what is stored. Anything
 * that is not an ACTIVE locale resolves to Norwegian — nothing is written to
 * the settings, so a stored choice survives until its language activates.
 */
export function resolveStartupLocale(stored: string | null): Locale {
  if (stored && (ACTIVE_LOCALES as readonly string[]).includes(stored)) {
    return stored as Locale;
  }
  return "no";
}

/**
 * The language in force now. Read it in a component to subscribe to changes;
 * never write it directly — `setLocale` is the one way, because the catalogue
 * must be loaded first.
 */
export const locale = signal<Locale>(currentLang as Locale);

/** Frozen shared empty list for `tArr` — a new array per call would be a new
 *  identity in every render. */
const NO_ITEMS: readonly string[] = Object.freeze([]);

/** Read the signal without using the value — the SUBSCRIPTION is the point. */
function track(): void {
  void locale.value;
}

/** Translate a key. */
export function t(key: string): string {
  track();
  return loaderT(key);
}

/** Translate a key with `{name}` interpolations. */
export function tf(
  key: string,
  params: Record<string, string | number>,
): string {
  track();
  return loaderTf(key, params);
}

/** Translate a counting key. `{n}` is bound to `count`. */
export function tn(
  key: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  track();
  return loaderTn(key, count, params);
}

/** Translate a key that is a LIST in the catalogue. */
export function tArr(key: string): string[] {
  track();
  return loaderTArr(key, NO_ITEMS as string[]);
}

/**
 * The ONE helper for a dynamic key: `tDyn("widget.label", def.kind)`. The
 * prefix MUST be a literal — the i18n-keys gate requires it to point at a
 * non-empty subtree in every catalogue. The suffix is the dynamic half the
 * gate cannot know, so we throw in DEV when the lookup misses instead of
 * rendering an empty label.
 */
export function tDyn(prefix: string, suffix: string): string {
  track();
  const value = loaderT(`${prefix}.${suffix}`);
  if (!value && import.meta.env.DEV) {
    throw new Error(
      `tDyn: «${prefix}.${suffix}» finnes ikke i katalogen for «${locale.value}».`,
    );
  }
  return value;
}

/**
 * Switch language: load the catalogue, then flip the signal — always in that
 * order (see the module header). Always resolves; an unknown code or a failed
 * import ends on `no`.
 */
export async function setLocale(lang: Locale): Promise<void> {
  await loadLocaleCatalogue(lang);
  locale.value = currentLang as Locale;
}
