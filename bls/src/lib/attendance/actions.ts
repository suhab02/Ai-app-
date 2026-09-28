"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fields, friendly, zodMessage, type ActionResult } from "@/lib/server-actions";
import { resolveSection } from "@/lib/school/resolve";
import { isIsoDate, schoolToday } from "@/lib/school/date";

const StatusSchema = z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED", "LEAVE"]);

const HeaderSchema = z.object({
  sectionId: z.uuid({ error: "Choose a section." }),
  date: z.string().refine(isIsoDate, { error: "Choose a valid date." }),
});

/**
 * Saves one section's attendance for one date. Form fields are `status:<studentId>`.
 * Guard order: role check here → Zod → RLS + validate_attendance trigger in the
 * database (teacher must teach the section, student must be actively enrolled in it,
 * no future dates, marked_by taken from the session — never from this payload).
 */
export async function saveAttendance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN", "ORGANIZER", "TEACHER"]);

  const raw = fields(formData);
  const header = HeaderSchema.safeParse(raw);
  if (!header.success) return { error: zodMessage(header.error) };
  const { sectionId, date } = header.data;

  if (date > schoolToday()) return { error: "Attendance cannot be marked for a future date." };

  const entries: { studentId: string; status: z.infer<typeof StatusSchema> }[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("status:")) continue;
    const studentId = z.uuid().safeParse(key.slice("status:".length));
    const status = StatusSchema.safeParse(value);
    if (!studentId.success || !status.success) return { error: "Invalid attendance entry." };
    entries.push({ studentId: studentId.data, status: status.data });
  }
  if (entries.length === 0) return { error: "Nothing to save." };

  const db = await createClient();
  const target = await resolveSection(db, sectionId);
  if (!target.ok) return { error: friendly(target.error) };

  const { error } = await db.from("attendance_records").upsert(
    entries.map((e) => ({
      student_id: e.studentId,
      academic_year_id: target.academicYearId,
      class_id: target.classId,
      section_id: target.sectionId,
      attendance_date: date,
      status: e.status,
    })),
    { onConflict: "student_id,attendance_date" },
  );
  if (error) return { error: friendly(error) };

  revalidatePath("/dashboard/attendance");
  return { ok: `Saved attendance for ${entries.length} student${entries.length === 1 ? "" : "s"}.` };
}
