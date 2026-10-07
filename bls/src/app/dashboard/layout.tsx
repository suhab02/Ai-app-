import { getCurrentProfile } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { ProfileMenu } from "@/components/profile-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Sidebar, BottomNav } from "@/components/dashboard/nav";
import { StatusBanner } from "@/components/status-banner";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const locale = await getLocale();
  const dictionary = getDictionary(locale);

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar dictionary={dictionary} role={profile.role} />
      <div className="flex flex-1 flex-col">
        <header className="flex print:hidden items-center justify-between border-b border-slate-200 bg-surface-card px-4 py-3 sm:px-6">
          <span className="text-base font-semibold text-brand-navy">{dictionary.common.appName}</span>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ProfileMenu profile={profile} />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 pb-20 sm:p-6 sm:pb-6 print:p-0">
          <StatusBanner status={profile.status} dictionary={dictionary} />
          {children}
        </main>
      </div>
      <BottomNav dictionary={dictionary} role={profile.role} />
    </div>
  );
}
