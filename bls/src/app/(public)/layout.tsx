import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createClient } from "@/lib/supabase/server";

/** Public website shell. No login needed; a signed-in visitor just sees "Portal" instead of "Log in". */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const d = getDictionary(await getLocale());
  const t = d.public;
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const signedIn = !!data?.claims;

  const links = [
    ["/", t.nav.home],
    ["/about", t.nav.about],
    ["/admissions", t.nav.admissions],
    ["/events", t.nav.events],
    ["/gallery", t.nav.gallery],
    ["/contact", t.nav.contact],
  ] as const;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">{t.skip}</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-brand-navy">{d.common.appName}</Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href={signedIn ? "/dashboard" : "/login"} className="rounded-xl bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green-dark">
              {signedIn ? t.nav.portal : t.nav.login}
            </Link>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-brand-navy hover:bg-brand-green-light">{label}</Link>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">{t.footer}</footer>
    </div>
  );
}
