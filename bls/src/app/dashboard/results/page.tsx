import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { SectionSubjectFields } from "@/components/school/section-subject-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createAssessment } from "@/lib/results/actions";
import { getSectionSubjectOptions } from "@/lib/school/assignment-options";
import { schoolToday } from "@/lib/school/date";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentKind } from "@/lib/supabase/types";

const KINDS: AssessmentKind[] = ["CLASS_TEST", "QUIZ", "MONTHLY", "TERM", "ANNUAL", "ASSIGNMENT", "PRACTICAL", "CUSTOM"];

export default async function ResultsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const d = getDictionary(await getLocale());
  const t = d.results;
  const db = await createClient();
  const label = await getSectionLabeler(db);

  const isGrader = profile.role === "SUPER_ADMIN" || profile.role === "ORGANIZER" || profile.role === "TEACHER";

  const [assessments, options] = await Promise.all([
    db.from("assessments").select("*").order("assessment_date", { ascending: false }),
    getSectionSubjectOptions(db, profile.role, label),
  ]);
  const subjectName = new Map(options.subjects.map((s) => [s.id, s.name]));

  if (isGrader) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>

        <Card>
          <CardHeader><CardTitle>{t.newAssessment}</CardTitle></CardHeader>
          {options.isTeacher && options.pairs.length === 0 ? (
            <p className="text-sm text-slate-500">{d.homework.noAssignments}</p>
          ) : (
            <ActionForm action={createAssessment} submitLabel={t.create}>
              <SectionSubjectFields options={options} labels={{ ...t, choose: d.homework.choose }} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select name="kind" label={t.kind} defaultValue="CLASS_TEST">
                  {KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
                </Select>
                <Input name="term" label={t.term} placeholder="Term 1" required />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input name="name" label={t.name} required />
                <Input name="maxMarks" type="number" step="0.01" min="0.01" label={t.maxMarks} required />
                <Input name="date" type="date" label={t.date} defaultValue={schoolToday()} required />
              </div>
            </ActionForm>
          )}
        </Card>

        {!assessments.data?.length ? (
          <Card><p className="text-sm text-slate-500">{t.noAssessments}</p></Card>
        ) : (
          <div className="flex flex-col gap-3">
            {assessments.data.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-brand-navy">{a.name} <span className="font-normal text-slate-400">· {t.kinds[a.kind]} · {a.term}</span></p>
                    <p className="text-xs text-slate-500">{subjectName.get(a.subject_id)} · {label(a.section_id)} · {a.assessment_date} · {t.maxMarks} {a.max_marks}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={a.is_published ? "green" : "orange"}>{a.is_published ? t.published : t.draft}</Badge>
                    <Link href={`/dashboard/results/${a.id}`} className="text-sm font-medium text-brand-green hover:underline">{t.open} →</Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Student / guardian. RLS already limits this to published assessments and the
  // caller's own / linked children's result rows.
  const [students, results] = await Promise.all([
    db.from("students").select("id, full_name").order("full_name"),
    db.from("assessment_results").select("assessment_id, student_id, marks_obtained, is_absent"),
  ]);
  const assessmentById = new Map(assessments.data?.map((a) => [a.id, a]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
      {!students.data?.length ? (
        <Card><p className="text-sm text-slate-500">{d.attendance.noChildren}</p></Card>
      ) : (
        students.data.map((student) => {
          const own = (results.data ?? []).filter((r) => r.student_id === student.id && assessmentById.has(r.assessment_id));
          const terms = [...new Set(own.map((r) => assessmentById.get(r.assessment_id)!.term))].sort();
          return (
            <Card key={student.id}>
              <CardHeader><CardTitle>{student.full_name}</CardTitle></CardHeader>
              {own.length === 0 ? (
                <p className="text-sm text-slate-500">{t.noResults}</p>
              ) : (
                <div className="flex flex-col gap-5">
                  {terms.map((term) => (
                    <div key={term}>
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-brand-navy">{term}</h4>
                        <Link
                          href={`/dashboard/results/report/${student.id}?term=${encodeURIComponent(term)}`}
                          className="text-sm font-medium text-brand-green hover:underline"
                        >
                          {t.viewReport} →
                        </Link>
                      </div>
                      <ul className="flex flex-col divide-y divide-slate-100 text-sm">
                        {own
                          .filter((r) => assessmentById.get(r.assessment_id)!.term === term)
                          .map((r) => {
                            const a = assessmentById.get(r.assessment_id)!;
                            return (
                              <li key={r.assessment_id} className="flex items-center justify-between py-2">
                                <span>{subjectName.get(a.subject_id)} · {a.name}</span>
                                <span className="font-medium text-brand-navy">
                                  {r.is_absent ? t.absent : `${r.marks_obtained} / ${a.max_marks}`}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
