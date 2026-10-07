"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fields, friendly, zodMessage, type ActionResult } from "@/lib/server-actions";
import { resolveSection } from "@/lib/school/resolve";
import { isIsoDate } from "@/lib/school/date";
import { parseSectionSubject } from "@/lib/school/section-subject";

const GRADERS = ["SUPER_ADMIN", "ORGANIZER", "TEACHER"] as const;

const CreateSchema = z.object({
  pair: z.string().optional(),
  sectionId: z.string().optional(),
  subjectId: z.string().optional(),
  kind: z.enum(["CLASS_TEST", "QUIZ", "MONTHLY", "TERM", "ANNUAL", "ASSIGNMENT", "PRACTICAL", "CUSTOM"]),
  name: z.string().trim().min(1, { error: "Enter a name." }).max(120),
  term: z.string().trim().min(1, { error: "Enter a term, e.g. Term 1." }).max(60),
  maxMarks: z.coerce.number({ error: "Enter the maximum marks." }).positive().max(9999.99),
  date: z.string().refine(isIsoDate, { error: "Choose a date." }),
});

/** Guard order: role → Zod → RLS. A teacher's insert only succeeds for a subject+section they are assigned. */
export async function createAssessment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole([...GRADERS]);

  const parsed = CreateSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const input = parsed.data;

  const ids = parseSectionSubject(input);
  if (!ids) return { error: "Choose a class section and subject." };

  const db = await createClient();
  const target = await resolveSection(db, ids.sectionId);
  if (!target.ok) return { error: friendly(target.error) };

  const { error } = await db.from("assessments").insert({
    academic_year_id: target.academicYearId,
    class_id: target.classId,
    section_id: target.sectionId,
    subject_id: ids.subjectId,
    kind: input.kind,
    name: input.name,
    term: input.term,
    max_marks: input.maxMarks,
    assessment_date: input.date,
  });
  if (error) return { error: friendly(error) };

  revalidatePath("/dashboard/results");
  return { ok: "Assessment created." };
}

const MarksHeader = z.object({ assessmentId: z.uuid() });
const MarksValue = z.coerce.number().min(0);

/**
 * Saves one assessment's marks. Fields: `marks:<studentId>` and `absent:<studentId>`.
 * A blank row with no absence is skipped (not entered yet). max_marks, enrolment and the
 * "frozen after publish" rule are enforced by the database trigger, not here.
 */
export async function saveResults(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole([...GRADERS]);

  const raw = fields(formData);
  const header = MarksHeader.safeParse(raw);
  if (!header.success) return { error: "Invalid assessment." };

  const studentIds = new Set<string>();
  for (const key of Object.keys(raw)) {
    const m = /^(?:marks|absent):(.+)$/.exec(key);
    if (m) studentIds.add(m[1]);
  }

  const rows: { assessment_id: string; student_id: string; marks_obtained: number | null; is_absent: boolean }[] = [];
  for (const studentId of studentIds) {
    if (!z.uuid().safeParse(studentId).success) return { error: "Invalid student." };
    const isAbsent = raw[`absent:${studentId}`] === "on";
    const text = (raw[`marks:${studentId}`] ?? "").trim();

    if (isAbsent) {
      rows.push({ assessment_id: header.data.assessmentId, student_id: studentId, marks_obtained: null, is_absent: true });
    } else if (text !== "") {
      const marks = MarksValue.safeParse(text);
      if (!marks.success) return { error: "Marks must be a number, 0 or more." };
      rows.push({ assessment_id: header.data.assessmentId, student_id: studentId, marks_obtained: marks.data, is_absent: false });
    }
  }
  if (rows.length === 0) return { error: "Enter at least one mark." };

  const db = await createClient();
  const { error } = await db.from("assessment_results").upsert(rows, { onConflict: "assessment_id,student_id" });
  if (error) return { error: friendly(error) };

  revalidatePath(`/dashboard/results/${header.data.assessmentId}`);
  return { ok: `Saved ${rows.length} result${rows.length === 1 ? "" : "s"}.` };
}

const PublishSchema = z.object({ assessmentId: z.uuid(), publish: z.enum(["true", "false"]) });

/** Publishing makes marks visible to the student/guardian and freezes them for teachers. Unpublishing is staff-only (trigger). */
export async function setAssessmentPublished(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole([...GRADERS]);

  const parsed = PublishSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: "Invalid request." };

  const db = await createClient();
  const { data, error } = await db
    .from("assessments")
    .update({ is_published: parsed.data.publish === "true" })
    .eq("id", parsed.data.assessmentId)
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Assessment not found or you cannot change it." };

  revalidatePath("/dashboard/results");
  revalidatePath(`/dashboard/results/${parsed.data.assessmentId}`);
  return { ok: parsed.data.publish === "true" ? "Results published." : "Results unpublished." };
}
