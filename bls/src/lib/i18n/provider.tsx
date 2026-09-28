"use client";

import { createContext, useContext, useMemo } from "react";
import type { Dictionary } from "./dictionary";
import { translate } from "./dictionary";
import type { Locale } from "./locales";

interface I18nContextValue {
  locale: Locale;
  dictionary: Dictionary;
  t: (path: string, vars?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dictionary,
      t: (path, vars) => translate(dictionary, path, vars),
    }),
    [locale, dictionary],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
