import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { computeReportCard, type ResultInput } from "@/lib/results/report-card";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

/**
 * Printable report card. Every query runs under the caller's RLS, so a student or
 * guardian can only load their own / their child's card, and only published marks
 * ever reach it. Grades come from the grading scale rows, never from code.
 */
export default async function ReportCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { studentId } = await params;
  const { term } = await searchParams;
  if (!z.uuid().safeParse(studentId).success) notFound();

  const locale = await getLocale();
  const d = getDictionary(locale);
  const t = d.results;
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const num = new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-GB", { maximumFractionDigits: 2 });

  const { data: student } = await db.from("students").select("id, full_name, full_name_bn, admission_number").eq("id", studentId).maybeSingle();
  if (!student) notFound();

  const [resultsRes, assessmentsRes, subjectsRes, enrollmentRes] = await Promise.all([
    db.from("assessment_results").select("assessment_id, marks_obtained, is_absent").eq("student_id", studentId),
    db.from("assessments").select("id, subject_id, max_marks, term, grading_scale_id, is_published").eq("is_published", true),
    db.from("subjects").select("id, name, name_bn"),
    db.from("student_enrollments").select("section_id").eq("student_id", studentId).eq("status", "ACTIVE").maybeSingle(),
  ]);

  const published = assessmentsRes.data ?? [];
  const terms = [...new Set(published.map((a) => a.term))].sort();
  const selectedTerm = term && terms.includes(term) ? term : terms[0];
  const inTerm = published.filter((a) => a.term === selectedTerm);
  const assessmentById = new Map(inTerm.map((a) => [a.id, a]));
  const subjectById = new Map(subjectsRes.data?.map((s) => [s.id, s]));

  const inputs: ResultInput[] = (resultsRes.data ?? [])
    .filter((r) => assessmentById.has(r.assessment_id))
    .map((r) => {
      const a = assessmentById.get(r.assessment_id)!;
      const subj = subjectById.get(a.subject_id);
      return {
        subjectId: a.subject_id,
        subjectName: (locale === "bn" && subj?.name_bn) || subj?.name || "",
        maxMarks: a.max_marks,
        marks: r.marks_obtained,
        isAbsent: r.is_absent,
      };
    });

  const scaleId = inTerm[0]?.grading_scale_id;
  const { data: bands } = scaleId
    ? await db.from("grading_scale_bands").select("letter, min_score, grade_point, is_pass").eq("scale_id", scaleId)
    : { data: [] };
  const card = computeReportCard(inputs, bands ?? []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold text-brand-navy">{t.reportCard}</h1>
        <div className="flex items-center gap-3">
          {terms.length > 1 && (
            <form method="get">
              <select name="term" defaultValue={selectedTerm} className="h-10 rounded-xl border border-slate-300 px-2 text-sm">
                {terms.map((x) => <option key={x}>{x}</option>)}
              </select>
              <button className="ml-2 h-10 rounded-xl bg-brand-navy px-3 text-sm text-white">{d.common.search}</button>
            </form>
          )}
          <PrintButton label={t.print} />
        </div>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-slate-200 pb-4 text-center">
          <p className="text-lg font-bold text-brand-navy">Bright Learning School</p>
          <p className="text-sm text-brand-navy">ব্রাইট লার্নিং স্কুল</p>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-green">{t.reportCard}{selectedTerm ? ` · ${selectedTerm}` : ""}</p>
        </header>

        <dl className="grid grid-cols-2 gap-3 py-4 text-sm">
          <div><dt className="text-slate-500">{t.student}</dt><dd className="font-medium text-brand-navy">{(locale === "bn" && student.full_name_bn) || student.full_name}</dd></div>
          <div><dt className="text-slate-500">ID</dt><dd className="font-mono text-brand-navy">{student.admission_number}</dd></div>
          {enrollmentRes.data && <div><dt className="text-slate-500">{t.class}</dt><dd className="font-medium text-brand-navy">{label(enrollmentRes.data.section_id)}</dd></div>}
        </dl>

        {card.subjects.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t.noData}</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">{t.subject}</th>
                  <th className="py-2 text-right">{t.obtained}</th>
                  <th className="py-2 text-right">{t.total}</th>
                  <th className="py-2 text-right">{t.percent}</th>
                  <th className="py-2 text-right">{t.grade}</th>
                  <th className="py-2 text-right">{t.gradePoint}</th>
                </tr>
              </thead>
              <tbody>
                {card.subjects.map((s) => (
                  <tr key={s.subjectId} className="border-b border-slate-100">
                    <td className="py-2">{s.subjectName}{s.absentCount > 0 ? " *" : ""}</td>
                    <td className="py-2 text-right">{num.format(s.obtained)}</td>
                    <td className="py-2 text-right">{num.format(s.max)}</td>
                    <td className="py-2 text-right">{num.format(s.percentage)}</td>
                    <td className={`py-2 text-right font-semibold ${s.isPass ? "text-brand-navy" : "text-red-600"}`}>{s.letter}</td>
                    <td className="py-2 text-right">{num.format(s.gradePoint)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-brand-navy">
                  <td className="py-3">{t.overall}</td>
                  <td className="py-3 text-right">{num.format(card.totalObtained)}</td>
                  <td className="py-3 text-right">{num.format(card.totalMax)}</td>
                  <td className="py-3 text-right">{card.percentage === null ? "—" : num.format(card.percentage)}</td>
                  <td className="py-3 text-right">{card.letter ?? "—"}</td>
                  <td className="py-3 text-right">{card.gpa === null ? "—" : num.format(card.gpa)}</td>
                </tr>
              </tfoot>
            </table>

            <p className={`mt-4 text-center text-lg font-bold ${card.passed ? "text-brand-green" : "text-red-600"}`}>
              {t.gpa}: {card.gpa === null ? "—" : num.format(card.gpa)} · {card.passed ? t.passed : t.failed}
            </p>
            {card.subjects.some((s) => s.absentCount > 0) && <p className="mt-2 text-xs text-slate-500">* {t.absentNote}</p>}
          </>
        )}

        <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div className="border-t border-slate-300 pt-2">{t.signature}</div>
          <div className="border-t border-slate-300 pt-2">{t.principal}</div>
        </footer>
      </article>
    </div>
  );
}
