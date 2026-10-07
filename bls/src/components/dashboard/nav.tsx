import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { translate } from "@/lib/i18n/dictionary";
import type { UserRole } from "@/lib/supabase/types";

interface NavItem {
  href: string;
  labelKey: string;
  roles?: UserRole[];
}

const STAFF: UserRole[] = ["SUPER_ADMIN", "ORGANIZER"];
const FEE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORGANIZER", "STUDENT", "PARENT"];

// Visibility here is UX only. Every /dashboard/admin page re-checks the
// caller with requireStaff() on the server, and RLS re-checks every query.
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard" },
  { href: "/dashboard/attendance", labelKey: "domain.attendance" },
  { href: "/dashboard/homework", labelKey: "domain.homework" },
  { href: "/dashboard/results", labelKey: "domain.results" },
  { href: "/dashboard/timetable", labelKey: "domain.timetable" },
  { href: "/dashboard/fees", labelKey: "domain.fees", roles: FEE_ROLES },
  { href: "/dashboard/notices", labelKey: "domain.notices" },
  { href: "/dashboard/gallery", labelKey: "domain.gallery", roles: STAFF },
  { href: "/dashboard/admin/users", labelKey: "nav.users", roles: STAFF },
  { href: "/dashboard/admin/academic", labelKey: "nav.academic", roles: STAFF },
  { href: "/dashboard/admin/people", labelKey: "nav.people", roles: STAFF },
  { href: "/dashboard/admin/relationships", labelKey: "nav.relationships", roles: STAFF },
];

function visibleItems(role: UserRole) {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

export function Sidebar({ dictionary, role }: { dictionary: Dictionary; role: UserRole }) {
  return (
    <aside className="hidden print:hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-surface-card p-4 sm:flex">
      {visibleItems(role).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-xl px-3 py-2.5 text-sm font-medium text-brand-navy hover:bg-brand-green-light"
        >
          {translate(dictionary, item.labelKey)}
        </Link>
      ))}
    </aside>
  );
}

export function BottomNav({ dictionary, role }: { dictionary: Dictionary; role: UserRole }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex print:hidden overflow-x-auto border-t border-slate-200 bg-surface-card sm:hidden">
      {visibleItems(role).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex min-w-[76px] flex-1 shrink-0 flex-col items-center gap-0.5 py-3 text-[11px] font-medium text-brand-navy"
        >
          {translate(dictionary, item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
