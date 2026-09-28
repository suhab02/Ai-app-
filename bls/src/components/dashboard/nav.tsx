import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionary";

interface NavItem {
  href: string;
  labelKey: string;
}

// One item today — the layout Phase 2 modules (students, attendance, ...)
// plug into as they land, without changing how the nav itself renders.
const NAV_ITEMS: NavItem[] = [{ href: "/dashboard", labelKey: "nav.dashboard" }];

function label(dictionary: Dictionary, path: string): string {
  return path.split(".").reduce<unknown>((acc, key) => {
    return acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined;
  }, dictionary) as string;
}

export function Sidebar({ dictionary }: { dictionary: Dictionary }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-surface-card p-4 sm:flex">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-xl px-3 py-2.5 text-sm font-medium text-brand-navy hover:bg-brand-green-light"
        >
          {label(dictionary, item.labelKey)}
        </Link>
      ))}
    </aside>
  );
}

export function BottomNav({ dictionary }: { dictionary: Dictionary }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-surface-card sm:hidden">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium text-brand-navy"
        >
          {label(dictionary, item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
