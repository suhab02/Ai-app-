import "server-only";

import type { Db, DbError } from "@/lib/server-actions";

export type ResolvedSection =
  | { ok: true; sectionId: string; classId: string; academicYearId: string }
  | { ok: false; error: DbError };

/**
 * Forms pick one section; the class and academic year are derived from it so
 * an inconsistent year/class/section combination can never be submitted.
 */
export async function resolveSection(db: Db, sectionId: string): Promise<ResolvedSection> {
  const { data: section, error } = await db.from("sections").select("id, class_id").eq("id", sectionId).maybeSingle();
  if (error) return { ok: false, error };
  if (!section) return { ok: false, error: { message: "Section not found." } };

  const { data: cls, error: classError } = await db
    .from("classes")
    .select("id, academic_year_id")
    .eq("id", section.class_id)
    .maybeSingle();
  if (classError) return { ok: false, error: classError };
  if (!cls) return { ok: false, error: { message: "Class not found." } };

  return { ok: true, sectionId: section.id, classId: cls.id, academicYearId: cls.academic_year_id };
}
