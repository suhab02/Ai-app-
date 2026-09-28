import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createGuardian, createStudent, createTeacher, linkAccount } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Kind = "students" | "guardians" | "teachers";

function LinkForm({ kind, recordId, label, action }: { kind: Kind; recordId: string; label: string; action: typeof linkAccount }) {
  return (
    <ActionForm action={action} submitLabel={label} compact className="mt-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="recordId" value={recordId} />
      <div className="flex-1">
        <Input name="email" type="email" placeholder="name@example.com" aria-label={label} required />
      </div>
    </ActionForm>
  );
}

export default async function PeoplePage() {
  await requireStaff();
  const d = getDictionary(await getLocale());
  const p = d.admin.people;
  const db = await createClient();

  const [students, guardians, teachers] = await Promise.all([
    db.from("students").select("*").order("admission_number"),
    db.from("guardians").select("*").order("full_name"),
    db.from("teachers").select("*").order("full_name"),
  ]);

  const status = (linked: boolean) => (
    <Badge tone={linked ? "green" : "slate"}>{linked ? p.linked : p.unlinked}</Badge>
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-brand-navy">{p.title}</h1>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{d.domain.students}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-3 text-sm">
            {students.data?.map((s) => (
              <li key={s.id} className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span><span className="font-mono text-slate-500">{s.admission_number}</span> {s.full_name}</span>
                  {status(!!s.profile_id)}
                </div>
                {!s.profile_id && <LinkForm kind="students" recordId={s.id} label={p.linkAccount} action={linkAccount} />}
              </li>
            ))}
            {!students.data?.length && <li className="text-slate-500">{p.empty}</li>}
          </ul>
          <ActionForm action={createStudent} submitLabel={d.common.create}>
            <Input name="admissionNumber" label={p.admissionNumber} required />
            <Input name="fullName" label={p.fullName} required />
            <Input name="fullNameBn" label={p.fullNameBn} />
            <div className="grid grid-cols-2 gap-3">
              <Input name="dateOfBirth" type="date" label={p.dateOfBirth} />
              <Select name="gender" label={p.gender} defaultValue="">
                <option value="">{d.common.none}</option>
                {(["MALE", "FEMALE", "OTHER"] as const).map((g) => <option key={g} value={g}>{d.enums.gender[g]}</option>)}
              </Select>
            </div>
            <Input name="phone" label={p.phone} />
            <Input name="address" label={p.address} />
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{d.domain.guardians}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-3 text-sm">
            {guardians.data?.map((g) => (
              <li key={g.id} className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span>{g.full_name}</span>
                  {status(!!g.profile_id)}
                </div>
                {!g.profile_id && <LinkForm kind="guardians" recordId={g.id} label={p.linkAccount} action={linkAccount} />}
              </li>
            ))}
            {!guardians.data?.length && <li className="text-slate-500">{p.empty}</li>}
          </ul>
          <ActionForm action={createGuardian} submitLabel={d.common.create}>
            <Input name="fullName" label={p.fullName} required />
            <Input name="fullNameBn" label={p.fullNameBn} />
            <div className="grid grid-cols-2 gap-3">
              <Input name="phone" label={p.phone} />
              <Input name="email" type="email" label={p.email} />
            </div>
            <Input name="occupation" label={p.occupation} />
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{d.domain.teachers}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-3 text-sm">
            {teachers.data?.map((t) => (
              <li key={t.id} className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span>{t.full_name}{t.designation ? ` · ${t.designation}` : ""}</span>
                  {status(!!t.profile_id)}
                </div>
                {!t.profile_id && <LinkForm kind="teachers" recordId={t.id} label={p.linkAccount} action={linkAccount} />}
              </li>
            ))}
            {!teachers.data?.length && <li className="text-slate-500">{p.empty}</li>}
          </ul>
          <ActionForm action={createTeacher} submitLabel={d.common.create}>
            <Input name="fullName" label={p.fullName} required />
            <Input name="fullNameBn" label={p.fullNameBn} />
            <div className="grid grid-cols-2 gap-3">
              <Input name="designation" label={p.designation} />
              <Input name="department" label={p.department} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input name="phone" label={p.phone} />
              <Input name="email" type="email" label={p.email} />
            </div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
