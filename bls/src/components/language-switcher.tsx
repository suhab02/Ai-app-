"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/locales";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1" role="group" aria-label={t("common.language")}>
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await setLocale(value);
              router.refresh();
            })
          }
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
            value === locale ? "bg-brand-navy text-white" : "text-brand-navy hover:bg-slate-100",
          )}
          aria-pressed={value === locale}
        >
          {LOCALE_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
