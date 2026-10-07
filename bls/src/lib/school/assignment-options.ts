import "server-only";

import type { Db } from "@/lib/server-actions";
import type { UserRole } from "@/lib/supabase/types";

export interface SectionSubjectOptions {
  isTeacher: boolean;
  subjects: { id: string; name: string }[];
  /** Teachers: only the (section, subject) pairs they are assigned, as "sectionId:subjectId". */
  pairs: { value: string; name: string }[];
  /** Staff: every section. */
  sectionOptions: { id: string; name: string }[];
}

/** Everything under the caller's RLS: a teacher only ever gets their own assignments back. */
export async function getSectionSubjectOptions(
  db: Db,
  role: UserRole,
  label: (sectionId: string) => string,
): Promise<SectionSubjectOptions> {
  const isTeacher = role === "TEACHER";
  const [subjects, sections, assignments] = await Promise.all([
    db.from("subjects").select("id, name").order("code"),
    isTeacher ? Promise.resolve({ data: [] as { id: string }[] }) : db.from("sections").select("id"),
    isTeacher
      ? db.from("teacher_assignments").select("section_id, subject_id")
      : Promise.resolve({ data: [] as { section_id: string; subject_id: string }[] }),
  ]);

  const subjectName = new Map(subjects.data?.map((s) => [s.id, s.name]));
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

  return {
    isTeacher,
    subjects: subjects.data ?? [],
    pairs: (assignments.data ?? [])
      .map((a) => ({ value: `${a.section_id}:${a.subject_id}`, name: `${label(a.section_id)} · ${subjectName.get(a.subject_id) ?? ""}` }))
      .sort(byName),
    sectionOptions: (sections.data ?? [])
      .map((s) => ({ id: s.id, name: label(s.id) }))
      .filter((o) => o.name)
      .sort(byName),
  };
}
