import "server-only";

import type { Db } from "@/lib/server-actions";
import type { Locale } from "@/lib/i18n/locales";
import type { SiteContentRow } from "@/lib/supabase/types";

export async function getSiteContent(db: Db): Promise<Map<string, SiteContentRow>> {
  const { data } = await db.from("site_content").select("*");
  return new Map((data ?? []).map((row) => [row.key, row]));
}

/** The text in the visitor's language, falling back to the other language when one is empty. */
export function pick(locale: Locale, en: string, bn: string): string {
  return (locale === "bn" ? bn || en : en || bn) ?? "";
}
