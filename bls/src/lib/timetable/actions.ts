"use server";

import * as z from "zod";
import { runStaff, type ActionResult } from "@/lib/server-actions";
import { resolveSection } from "@/lib/school/resolve";

const time = z.string().regex(/^\d{2}:\d{2}$/, { error: "Use HH:MM." });
const checkbox = z.string().optional().transform((v) => v === "on" || v === "true");
const optionalText = z.string().trim().optional().transform((v) => (v ? v : undefined));

const PeriodSchema = z.object({
  periodNo: z.coerce.number().int().min(1).max(30),
  label: z.string().trim().min(1, { error: "Enter a label." }).max(60),
  startTime: time,
  endTime: time,
  isBreak: checkbox,
});

export async function createPeriod(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, PeriodSchema, ["/dashboard/timetable"], "Period saved.", (i, db) =>
    db.from("timetable_periods").insert({
      period_no: i.periodNo,
      label: i.label,
      start_time: i.startTime,
      end_time: i.endTime,
      is_break: i.isBreak,
    }),
  );
}

const EntrySchema = z.object({
  sectionId: z.uuid({ error: "Choose a section." }),
  weekday: z.coerce.number().int().min(0).max(6),
  periodId: z.uuid({ error: "Choose a period." }),
  subjectId: z.uuid({ error: "Choose a subject." }),
  teacherId: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.uuid().optional()),
  room: optionalText,
});

// The database rejects a teacher who isn't assigned this subject+section, a double-booked
// teacher, a lesson in a break, and a slot that is already taken — those messages are shown as-is.
export async function createTimetableEntry(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, EntrySchema, ["/dashboard/timetable"], "Lesson scheduled.", async (i, db) => {
    const target = await resolveSection(db, i.sectionId);
    if (!target.ok) return { error: target.error };
    return db.from("timetable_entries").insert({
      academic_year_id: target.academicYearId,
      class_id: target.classId,
      section_id: target.sectionId,
      weekday: i.weekday,
      period_id: i.periodId,
      subject_id: i.subjectId,
      teacher_id: i.teacherId ?? null,
      room: i.room ?? null,
    });
  });
}

export async function deleteTimetableEntry(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, z.object({ id: z.uuid() }), ["/dashboard/timetable"], "Lesson removed.", (i, db) =>
    db.from("timetable_entries").delete().eq("id", i.id),
  );
}
