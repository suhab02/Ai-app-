import en from "./dictionaries/en.json";
import bn from "./dictionaries/bn.json";
import type { Locale } from "./locales";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, bn: bn as Dictionary };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

function getPath(dictionary: Dictionary, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      dictionary,
    );
}

/** Dot-path lookup with `{placeholder}` interpolation, e.g. t(dict, "dashboard.welcome", { name }). */
export function translate(dictionary: Dictionary, path: string, vars?: Record<string, string>): string {
  const value = getPath(dictionary, path);
  if (typeof value !== "string") return path;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
