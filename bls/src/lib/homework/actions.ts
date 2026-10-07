"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fields, friendly, zodMessage, type ActionResult } from "@/lib/server-actions";
import { resolveSection } from "@/lib/school/resolve";
import { isIsoDate } from "@/lib/school/date";
import { parseSectionSubject } from "@/lib/school/section-subject";

const CreateSchema = z.object({
  // Teachers pick one "sectionId:subjectId" pair from their own assignments;
  // staff pick the two separately. Both shapes end up as the same two ids.
  pair: z.string().optional(),
  sectionId: z.string().optional(),
  subjectId: z.string().optional(),
  title: z.string().trim().min(1, { error: "Enter a title." }).max(200),
  description: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  dueDate: z.string().refine(isIsoDate, { error: "Choose a due date." }),
});

/**
 * Guard order: role check → Zod → RLS. For a TEACHER the database only accepts the
 * insert if that teacher owns the row (teacher_id = their own teachers.id, which
 * is looked up here from the session, never taken from the form) AND is assigned
 * that subject in that section (teaches_subject()).
 */
export async function createHomework(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await requireRole(["SUPER_ADMIN", "ORGANIZER", "TEACHER"]);

  const parsed = CreateSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const input = parsed.data;

  const ids = parseSectionSubject(input);
  if (!ids) return { error: "Choose a class section and subject." };

  const db = await createClient();
  const target = await resolveSection(db, ids.sectionId);
  if (!target.ok) return { error: friendly(target.error) };

  let teacherId: string | null = null;
  if (actor.role === "TEACHER") {
    const { data: teacher, error } = await db.from("teachers").select("id").eq("profile_id", actor.id).maybeSingle();
    if (error) return { error: friendly(error) };
    if (!teacher) return { error: "Your account is not linked to a teacher record yet." };
    teacherId = teacher.id;
  }

  const { error } = await db.from("homework").insert({
    academic_year_id: target.academicYearId,
    class_id: target.classId,
    section_id: target.sectionId,
    subject_id: ids.subjectId,
    teacher_id: teacherId,
    title: input.title,
    description: input.description ?? null,
    due_date: input.dueDate,
  });
  if (error) return { error: friendly(error) };

  revalidatePath("/dashboard/homework");
  return { ok: "Homework posted." };
}

export async function deleteHomework(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN", "ORGANIZER", "TEACHER"]);

  const id = z.uuid().safeParse(fields(formData).id);
  if (!id.success) return { error: "Invalid homework." };

  const db = await createClient();
  // RLS limits this to the teacher's own rows (or staff); a foreign id deletes 0 rows.
  const { data, error } = await db.from("homework").delete().eq("id", id.data).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Homework not found or you cannot delete it." };

  revalidatePath("/dashboard/homework");
  return { ok: "Homework deleted." };
}
