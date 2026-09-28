import { getCurrentProfile } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import type { UserRole } from "@/lib/supabase/types";

type DomainKey = keyof Dictionary["domain"];

// What each role will eventually manage or see (Phase 2+). Phase 1 only
// proves the role reaches the right shell with the right scope — the actual
// data views land module by module.
const ROLE_MODULES: Record<UserRole, DomainKey[]> = {
  SUPER_ADMIN: [
    "students",
    "teachers",
    "guardians",
    "attendance",
    "homework",
    "results",
    "timetable",
    "fees",
    "payments",
    "notices",
    "events",
    "gallery",
  ],
  ORGANIZER: [
    "students",
    "teachers",
    "guardians",
    "attendance",
    "homework",
    "results",
    "timetable",
    "fees",
    "payments",
    "notices",
    "events",
    "gallery",
  ],
  TEACHER: ["attendance", "homework", "results", "timetable"],
  STUDENT: ["attendance", "homework", "results", "timetable", "notices", "events", "fees"],
  PARENT: ["attendance", "homework", "results", "notices", "events", "fees", "payments"],
};

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const dictionary = getDictionary(await getLocale());
  const modules = ROLE_MODULES[profile.role];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-brand-navy">
              {dictionary.dashboard.welcome.replace("{name}", profile.full_name ?? profile.email ?? "")}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {dictionary.dashboard.yourId}: <span className="font-mono">{profile.display_id}</span>
            </p>
          </div>
          <Badge tone="green">{dictionary.roles[profile.role]}</Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{dictionary.domain[key]}</CardTitle>
            </CardHeader>
            <p className="text-sm text-slate-500">{dictionary.dashboard.comingSoon}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
