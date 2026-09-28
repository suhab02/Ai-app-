import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold text-brand-navy">
          Bright Learning School
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-surface-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
