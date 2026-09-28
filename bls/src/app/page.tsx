import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function Home() {
  const dictionary = getDictionary(await getLocale());

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold text-brand-navy">{dictionary.common.appName}</span>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-brand-navy sm:text-4xl">
            {dictionary.common.appName}
          </h1>
          <p className="max-w-md text-sm text-slate-500 sm:text-base">
            {dictionary.dashboard.comingSoon}
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          <Link href="/login">
            <Button>{dictionary.nav.login}</Button>
          </Link>
          <Link href="/signup">
            <Button variant="outline">{dictionary.nav.signup}</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
