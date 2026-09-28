import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createAcademicYear, createClass, createSection, createSubject } from "@/lib/admin/actions";
import { ActionForm, Checkbox } from "@/components/admin/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export default async function AcademicPage() {
  await requireStaff();
  const d = getDictionary(await getLocale());
  const a = d.admin.academic;
  const db = await createClient();

  const [years, classes, sections, subjects] = await Promise.all([
    db.from("academic_years").select("*").order("start_date", { ascending: false }),
    db.from("classes").select("*").order("order_index"),
    db.from("sections").select("*").order("name"),
    db.from("subjects").select("*").order("code"),
  ]);
  const yearName = new Map(years.data?.map((y) => [y.id, y.name]));
  const className = new Map(classes.data?.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-brand-navy">{a.title}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{a.years}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {years.data?.map((y) => (
              <li key={y.id} className="flex items-center justify-between">
                <span>{y.name} <span className="text-slate-400">({y.start_date} → {y.end_date})</span></span>
                {y.is_current && <Badge tone="green">{a.current}</Badge>}
              </li>
            ))}
            {!years.data?.length && <li className="text-slate-500">{a.empty}</li>}
          </ul>
          <ActionForm action={createAcademicYear} submitLabel={d.common.create}>
            <Input name="name" label={a.name} placeholder="2026-2027" required />
            <div className="grid grid-cols-2 gap-3">
              <Input name="startDate" type="date" label={a.startDate} required />
              <Input name="endDate" type="date" label={a.endDate} required />
            </div>
            <Checkbox name="isCurrent" label={a.current} />
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{a.subjects}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {subjects.data?.map((s) => (
              <li key={s.id}><span className="font-mono text-slate-500">{s.code}</span> {s.name}{s.name_bn ? ` · ${s.name_bn}` : ""}</li>
            ))}
            {!subjects.data?.length && <li className="text-slate-500">{a.empty}</li>}
          </ul>
          <ActionForm action={createSubject} submitLabel={d.common.create}>
            <div className="grid grid-cols-3 gap-3">
              <Input name="code" label={a.code} required />
              <Input name="name" label={a.name} required />
              <Input name="nameBn" label={a.nameBn} />
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{a.classes}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {classes.data?.map((c) => (
              <li key={c.id}>{c.name}{c.name_bn ? ` · ${c.name_bn}` : ""} <span className="text-slate-400">({yearName.get(c.academic_year_id)})</span></li>
            ))}
            {!classes.data?.length && <li className="text-slate-500">{a.empty}</li>}
          </ul>
          <ActionForm action={createClass} submitLabel={d.common.create}>
            <Select name="academicYearId" label={a.year} required>
              {years.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </Select>
            <div className="grid grid-cols-3 gap-3">
              <Input name="name" label={a.name} placeholder="Class 6" required />
              <Input name="nameBn" label={a.nameBn} />
              <Input name="orderIndex" type="number" min={0} label={a.order} defaultValue={0} />
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{a.sections}</CardTitle></CardHeader>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {sections.data?.map((s) => (
              <li key={s.id}>{className.get(s.class_id)} – {s.name}{s.capacity ? ` (${s.capacity})` : ""}</li>
            ))}
            {!sections.data?.length && <li className="text-slate-500">{a.empty}</li>}
          </ul>
          <ActionForm action={createSection} submitLabel={d.common.create}>
            <Select name="classId" label={a.class} required>
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({yearName.get(c.academic_year_id)})</option>)}
            </Select>
            <div className="grid grid-cols-3 gap-3">
              <Input name="name" label={a.name} placeholder="A" required />
              <Input name="nameBn" label={a.nameBn} />
              <Input name="capacity" type="number" min={1} label={a.capacity} />
            </div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
