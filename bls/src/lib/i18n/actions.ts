"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "./locales";

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
