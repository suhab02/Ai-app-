import { logout } from "@/lib/auth/actions";
import type { ProfileRow } from "@/lib/supabase/types";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { Badge } from "@/components/ui/badge";

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export async function ProfileMenu({ profile }: { profile: ProfileRow }) {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-semibold text-brand-navy">{profile.full_name ?? profile.email}</p>
        <p className="text-xs text-slate-500">{profile.display_id}</p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-navy text-sm font-semibold text-white">
        {initials(profile.full_name)}
      </div>
      <Badge tone="green" className="hidden md:inline-flex">
        {dictionary.roles[profile.role]}
      </Badge>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-brand-navy hover:bg-slate-50"
        >
          {dictionary.nav.logout}
        </button>
      </form>
    </div>
  );
}
