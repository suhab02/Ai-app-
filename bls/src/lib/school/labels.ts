import "server-only";

import type { Db } from "@/lib/server-actions";

/** Returns a function mapping a section id to "Class 5 – A (2025-2026)". Reads run under the caller's RLS. */
export async function getSectionLabeler(db: Db) {
  const [years, classes, sections] = await Promise.all([
    db.from("academic_years").select("id, name"),
    db.from("classes").select("id, name, academic_year_id"),
    db.from("sections").select("id, name, class_id"),
  ]);
  const yearName = new Map(years.data?.map((y) => [y.id, y.name]));
  const classById = new Map(classes.data?.map((c) => [c.id, c]));
  const sectionById = new Map(sections.data?.map((s) => [s.id, s]));

  return (sectionId: string): string => {
    const s = sectionById.get(sectionId);
    const c = s && classById.get(s.class_id);
    return s && c ? `${c.name} – ${s.name} (${yearName.get(c.academic_year_id)})` : "";
  };
}
