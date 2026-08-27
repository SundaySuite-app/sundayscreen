// The catalogue loader — the DATA half of i18n. The reactive half (the locale
// signal and the shell's `t(key)` with no fallback argument) is
// `app/i18n/index.ts`; this module keeps the legacy `t(key, fallback)`
// signature because the api-shim reads copy through it BEFORE the shell has
// installed anything.
//
// Only the default locale is bundled eagerly; the rest are dynamic-imported on
// first use so unused catalogues stay out of the initial bundle.

import noLocale from "../i18n/locales/no.json";

type LocaleData = Record<string, unknown>;

const LOCALE_MAP: Record<string, LocaleData> = {
  no: noLocale as LocaleData,
};

/** Dynamic-import loaders for the non-default locales. Vite emits each as its
 *  own chunk, fetched only when that language is selected. */
const LAZY_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  en: () => import("../i18n/locales/en.json"),
};

export let T: LocaleData = LOCALE_MAP["no"];
export let currentLang = "no";

/**
 * Load a locale's CATALOGUE and make it active. `app/i18n/index.ts` awaits
 * this and only THEN flips its `locale` signal, so a render can never happen
 * with the new language and the old catalogue.
 */
export async function loadLocaleCatalogue(lang: string): Promise<void> {
  if (!LOCALE_MAP[lang]) {
    const loader = LAZY_LOADERS[lang];
    if (loader) {
      try {
        LOCALE_MAP[lang] = (await loader()).default as LocaleData;
      } catch {
        // fall through to the 'no' fallback below
      }
    }
  }
  T = LOCALE_MAP[lang] ?? LOCALE_MAP["no"];
  currentLang = LOCALE_MAP[lang] ? lang : "no";
}

/** Raw catalogue lookup — may return a string, a plural group object, an array
 *  or undefined. `t`/`tn` each narrow it their own way. */
function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], T);
}

export function t(key: string, fallback = ""): string {
  const val = lookup(key);
  // A plural group is an OBJECT — anything that is not a string is not a
  // translation, so it takes the fallback rather than "[object Object]".
  return typeof val === "string" ? val : fallback;
}

/**
 * The ONE BCP-47 tag for date/number/plural formatting: bokmål for 'no'
 * (plain 'no' gives nynorsk-flavoured output in some engines).
 */
export function localeTag(lang: string = currentLang): string {
  return lang === "no" ? "nb-NO" : lang;
}

/**
 * Substitute `{name}` placeholders. `replaceAll`, not `replace`, so a string
 * naming the same placeholder twice renders both. A placeholder with no
 * matching param is LEFT VISIBLE as `{n}` — substituting '' would read as
 * finished copy and hide the bug from everyone.
 */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(params))
    out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Cached per language — Intl.PluralRules construction is not free. */
const pluralRules = new Map<string, Intl.PluralRules>();

export function pluralCategory(
  count: number,
  lang: string = currentLang,
): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(localeTag(lang));
    pluralRules.set(lang, rules);
  }
  return rules.select(count);
}

/**
 * Pick the right form out of a plural group. `node` is the raw catalogue
 * value: a group object keyed by CLDR category, or a plain string for a key
 * that was never pluralized. Returns undefined when there is nothing usable.
 */
export function selectPluralForm(
  node: unknown,
  count: number,
  lang: string = currentLang,
): string | undefined {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || Array.isArray(node))
    return undefined;
  const group = node as Record<string, unknown>;
  const exact = group[pluralCategory(count, lang)];
  if (typeof exact === "string") return exact;
  // `other` is the universal fallback.
  return typeof group["other"] === "string" ? group["other"] : undefined;
}

/** Interpolating `t`. */
export function tf(
  key: string,
  params: Record<string, string | number>,
  fallback = "",
): string {
  return interpolate(t(key, fallback), params);
}

/**
 * Count-aware `t`. Looks up the CLDR category for `count` in the active
 * language, falling back to `other`, then to a flat string, then to
 * `fallback`. `{n}` is pre-bound to `count`.
 */
export function tn(
  key: string,
  count: number,
  params: Record<string, string | number> = {},
  fallback = "",
): string {
  const form = selectPluralForm(lookup(key), count, currentLang) ?? fallback;
  return interpolate(form, { n: count, ...params });
}

export function tArr(key: string, fallback: string[]): string[] {
  const val = lookup(key);
  return Array.isArray(val) ? (val as string[]) : fallback;
}
