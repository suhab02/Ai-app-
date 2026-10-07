import { redirect } from "next/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionSubjectFields } from "@/components/school/section-subject-fields";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createHomework, deleteHomework } from "@/lib/homework/actions";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { schoolToday } from "@/lib/school/date";
import { getSectionSubjectOptions } from "@/lib/school/assignment-options";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";

export default async function HomeworkPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const d = getDictionary(await getLocale());
  const t = d.homework;
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const today = schoolToday();

  const isStaff = profile.role === "SUPER_ADMIN" || profile.role === "ORGANIZER";
  const isTeacher = profile.role === "TEACHER";
  const canPost = isStaff || isTeacher;

  // Everything below is read under the caller's RLS: students/guardians get their
  // section's homework, teachers their sections', staff everything.
  const [homework, options, me] = await Promise.all([
    db.from("homework").select("*").order("due_date", { ascending: true }),
    getSectionSubjectOptions(db, profile.role, label),
    isTeacher ? db.from("teachers").select("id").eq("profile_id", profile.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const subjectName = new Map(options.subjects.map((s) => [s.id, s.name]));
  const myTeacherId = me.data?.id;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>

      {canPost && (
        <Card>
          <CardHeader><CardTitle>{t.post}</CardTitle></CardHeader>
          {isTeacher && options.pairs.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noAssignments}</p>
          ) : (
            <ActionForm action={createHomework} submitLabel={t.submit}>
              <SectionSubjectFields options={options} labels={t} />
              <Input name="title" label={t.titleField} maxLength={200} required />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="description" className="text-sm font-medium text-brand-navy">{t.description}</label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                />
              </div>
              <Input name="dueDate" type="date" label={t.dueDate} min={today} required />
            </ActionForm>
          )}
        </Card>
      )}

      {!homework.data?.length ? (
        <Card><p className="text-sm text-slate-500">{t.noHomework}</p></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {homework.data.map((h) => {
            const overdue = h.due_date < today;
            const dueToday = h.due_date === today;
            const canDelete = isStaff || (isTeacher && h.teacher_id === myTeacherId);
            return (
              <Card key={h.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-brand-navy">{h.title}</p>
                    <p className="text-xs text-slate-500">
                      {subjectName.get(h.subject_id)} · {label(h.section_id)}
                    </p>
                  </div>
                  <Badge tone={overdue ? "red" : dueToday ? "orange" : "green"}>
                    {overdue ? t.overdue : dueToday ? t.dueToday : t.upcoming} · {t.due} {h.due_date}
                  </Badge>
                </div>
                {h.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{h.description}</p>}
                {h.teacher_id === null && <p className="mt-2 text-xs text-slate-400">{t.postedByOffice}</p>}
                {canDelete && (
                  <ActionForm action={deleteHomework} submitLabel={t.delete} className="mt-3">
                    <input type="hidden" name="id" value={h.id} />
                  </ActionForm>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
