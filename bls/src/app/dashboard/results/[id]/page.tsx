import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { saveResults, setAssessmentPublished } from "@/lib/results/actions";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(["SUPER_ADMIN", "ORGANIZER", "TEACHER"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const d = getDictionary(await getLocale());
  const t = d.results;
  const db = await createClient();
  const label = await getSectionLabeler(db);

  // Under RLS: a teacher gets this row only for a subject+section they teach.
  const { data: assessment } = await db.from("assessments").select("*").eq("id", id).maybeSingle();
  if (!assessment) notFound();

  const isStaff = profile.role !== "TEACHER";
  const locked = assessment.is_published && !isStaff;

  const [subject, enrollments, results] = await Promise.all([
    db.from("subjects").select("name").eq("id", assessment.subject_id).maybeSingle(),
    db.from("student_enrollments").select("student_id, roll_number").eq("section_id", assessment.section_id).eq("status", "ACTIVE"),
    db.from("assessment_results").select("student_id, marks_obtained, is_absent").eq("assessment_id", id),
  ]);
  const studentIds = enrollments.data?.map((e) => e.student_id) ?? [];
  const students = studentIds.length ? await db.from("students").select("id, full_name").in("id", studentIds) : { data: [] };
  const nameById = new Map(students.data?.map((s) => [s.id, s.full_name]));
  const resultById = new Map(results.data?.map((r) => [r.student_id, r]));
  const roster = (enrollments.data ?? [])
    .map((e) => ({ id: e.student_id, roll: e.roll_number, name: nameById.get(e.student_id) ?? "" }))
    .sort((a, b) => Number(a.roll ?? 1e9) - Number(b.roll ?? 1e9) || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/results" className="text-sm text-brand-green hover:underline">← {t.back}</Link>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-brand-navy">{assessment.name}</h1>
            <p className="text-xs text-slate-500">
              {subject.data?.name} · {label(assessment.section_id)} · {t.kinds[assessment.kind]} · {assessment.term} · {t.maxMarks} {assessment.max_marks}
            </p>
          </div>
          <Badge tone={assessment.is_published ? "green" : "orange"}>{assessment.is_published ? t.published : t.draft}</Badge>
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.enterMarks}</CardTitle></CardHeader>
        {locked && <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{t.locked}</p>}
        {roster.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noStudents}</p>
        ) : (
          <ActionForm action={saveResults} submitLabel={t.save}>
            <input type="hidden" name="assessmentId" value={assessment.id} />
            <ul className="flex flex-col divide-y divide-slate-100">
              {roster.map((s) => {
                const r = resultById.get(s.id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="text-sm font-medium text-brand-navy">
                      {s.roll && <span className="mr-2 font-mono text-slate-400">{s.roll}</span>}
                      {s.name}
                    </span>
                    <span className="flex items-center gap-3">
                      <input
                        name={`marks:${s.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        max={assessment.max_marks}
                        defaultValue={r?.marks_obtained ?? ""}
                        disabled={locked}
                        aria-label={`${t.marks} – ${s.name}`}
                        className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-right text-sm disabled:bg-slate-50"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input type="checkbox" name={`absent:${s.id}`} defaultChecked={r?.is_absent} disabled={locked} className="h-4 w-4 accent-brand-green" />
                        {t.absent}
                      </label>
                    </span>
                  </li>
                );
              })}
            </ul>
          </ActionForm>
        )}
      </Card>

      {(!assessment.is_published || isStaff) && (
        <ActionForm action={setAssessmentPublished} submitLabel={assessment.is_published ? t.unpublish : t.publish}>
          <input type="hidden" name="assessmentId" value={assessment.id} />
          <input type="hidden" name="publish" value={assessment.is_published ? "false" : "true"} />
        </ActionForm>
      )}
    </div>
  );
}
