import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { requireStaff } from "@/lib/auth/dal";
import { updateApplication } from "@/lib/admissions/actions";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationStatus } from "@/lib/supabase/types";

const STATUSES: ApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"];
const TONE = { SUBMITTED: "orange", UNDER_REVIEW: "navy", ACCEPTED: "green", REJECTED: "red" } as const;
const isStatus = (v: string | undefined): v is ApplicationStatus => !!v && (STATUSES as string[]).includes(v);

export default async function AdmissionsAdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaff();
  const { status } = await searchParams;
  const d = getDictionary(await getLocale());
  const t = d.admissions;
  const db = await createClient();

  let query = db.from("admission_applications").select("*").order("created_at", { ascending: false }).limit(200);
  if (isStatus(status)) query = query.eq("status", status);
  const { data: applications, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.adminTitle}</h1>

      <Card>
        <form method="get" className="flex items-end gap-3">
          <div className="flex-1">
            <Select name="status" label={t.status} defaultValue={status ?? ""}>
              <option value="">{t.all}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t.statuses[s]}</option>)}
            </Select>
          </div>
          <button className="h-11 rounded-xl bg-brand-navy px-4 text-sm font-medium text-white">{d.common.search}</button>
        </form>
      </Card>

      {!applications?.length && <p className="text-sm text-slate-500">{t.none}</p>}

      {applications?.map((a) => (
        <Card key={a.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-brand-navy">{a.applicant_name}{a.applicant_name_bn ? ` · ${a.applicant_name_bn}` : ""}</p>
              <p className="text-xs text-slate-500">
                {a.desired_class} · {a.date_of_birth}{a.gender ? ` · ${d.enums.gender[a.gender]}` : ""}{a.previous_school ? ` · ${a.previous_school}` : ""}
              </p>
            </div>
            <Badge tone={TONE[a.status]}>{t.statuses[a.status]}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">{t.guardian}</dt><dd className="text-brand-navy">{a.guardian_name}</dd></div>
            <div><dt className="text-xs text-slate-500">{t.guardianPhone}</dt><dd className="text-brand-navy">{a.guardian_phone}</dd></div>
            <div><dt className="text-xs text-slate-500">{t.applied}</dt><dd className="text-brand-navy">{a.created_at.slice(0, 10)}</dd></div>
          </dl>
          {(a.guardian_email || a.address || a.message) && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{[a.guardian_email, a.address, a.message].filter(Boolean).join("\n")}</p>
          )}
          <ActionForm action={updateApplication} submitLabel={t.update} className="mt-3">
            <input type="hidden" name="id" value={a.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select name="status" label={t.status} defaultValue={a.status}>
                {STATUSES.map((s) => <option key={s} value={s}>{t.statuses[s]}</option>)}
              </Select>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor={`notes-${a.id}`} className="text-sm font-medium text-brand-navy">{t.notes}</label>
                <input id={`notes-${a.id}`} name="reviewNotes" defaultValue={a.review_notes ?? ""} maxLength={2000} className="h-11 rounded-xl border border-slate-300 px-3.5 text-sm" />
              </div>
            </div>
          </ActionForm>
        </Card>
      ))}
    </div>
  );
}
