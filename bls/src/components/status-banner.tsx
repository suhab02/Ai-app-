import type { AccountStatus } from "@/lib/supabase/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

const BANNER_STYLES: Partial<Record<AccountStatus, string>> = {
  PENDING: "border-brand-orange-dark/30 bg-brand-orange-light text-brand-orange-dark",
  SUSPENDED: "border-red-200 bg-red-50 text-red-700",
  INACTIVE: "border-slate-300 bg-slate-100 text-slate-600",
  ARCHIVED: "border-slate-300 bg-slate-100 text-slate-600",
};

const BANNER_KEY: Partial<Record<AccountStatus, keyof Dictionary["status"]>> = {
  PENDING: "pendingBanner",
  SUSPENDED: "suspendedBanner",
};

export function StatusBanner({ status, dictionary }: { status: AccountStatus; dictionary: Dictionary }) {
  if (status === "ACTIVE") return null;

  const key = BANNER_KEY[status];
  const message = key ? dictionary.status[key] : dictionary.status[status];
  const style = BANNER_STYLES[status] ?? BANNER_STYLES.INACTIVE;

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${style}`} role="status">
      {message}
    </div>
  );
}
