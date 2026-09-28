import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { assignTeacher, enrollStudent, linkGuardian } from "@/lib/admin/actions";
import { ActionForm, Checkbox } from "@/components/admin/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { GuardianRelationship } from "@/lib/supabase/types";

const RELATIONSHIPS: GuardianRelationship[] = [
  "FATHER", "MOTHER", "GRANDFATHER", "GRANDMOTHER", "UNCLE", "AUNT", "SIBLING", "LEGAL_GUARDIAN", "OTHER",
];

export default async function RelationshipsPage() {
  await requireStaff();
  const d = getDictionary(await getLocale());
  const r = d.admin.relationships;
  const db = await createClient();

  const [years, classes, sections, subjects, students, guardians, teachers, enrollments, links, assignments] =
    await Promise.all([
      db.from("academic_years").select("id, name"),
      db.from("classes").select("id, name, academic_year_id"),
      db.from("sections").select("id, name, class_id").order("name"),
      db.from("subjects").select("id, code, name").order("code"),
      db.from("students").select("id, full_name, admission_number").order("admission_number"),
      db.from("guardians").select("id, full_name").order("full_name"),
      db.from("teachers").select("id, full_name").order("full_name"),
      db.from("student_enrollments").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("student_guardians").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("teacher_assignments").select("*").order("created_at", { ascending: false }).limit(100),
    ]);

  const yearName = new Map(years.data?.map((y) => [y.id, y.name]));
  const classById = new Map(classes.data?.map((c) => [c.id, c]));
  const sectionLabel = (sectionId: string) => {
    const s = sections.data?.find((x) => x.id === sectionId);
    const c = s && classById.get(s.class_id);
    return s && c ? `${c.name} – ${s.name} (${yearName.get(c.academic_year_id)})` : "?";
  };
  const studentName = new Map(students.data?.map((s) => [s.id, s.full_name]));
  const guardianName = new Map(guardians.data?.map((g) => [g.id, g.full_name]));
  const teacherName = new Map(teachers.data?.map((t) => [t.id, t.full_name]));
  const subjectName = new Map(subjects.data?.map((s) => [s.id, s.name]));

  const sectionOptions = sections.data?.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s.id)}</option>);
  const studentOptions = students.data?.map((s) => <option key={s.id} value={s.id}>{s.admission_number} · {s.full_name}</option>);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-brand-navy">{r.title}</h1>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{r.enrollStudent}</CardTitle></CardHeader>
          <ActionForm action={enrollStudent} submitLabel={d.common.create}>
            <Select name="studentId" label={r.student} required>{studentOptions}</Select>
            <Select name="sectionId" label={r.section} required>{sectionOptions}</Select>
            <Input name="rollNumber" label={r.roll} />
          </ActionForm>
          <h4 className="mb-2 mt-5 text-sm font-semibold text-brand-navy">{r.enrollments}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {enrollments.data?.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span>{studentName.get(e.student_id)} — {sectionLabel(e.section_id)}{e.roll_number ? ` #${e.roll_number}` : ""}</span>
                <Badge tone={e.status === "ACTIVE" ? "green" : "slate"}>{e.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader><CardTitle>{r.linkGuardian}</CardTitle></CardHeader>
          <ActionForm action={linkGuardian} submitLabel={d.common.create}>
            <Select name="studentId" label={r.student} required>{studentOptions}</Select>
            <Select name="guardianId" label={r.guardian} required>
              {guardians.data?.map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </Select>
            <Select name="relationship" label={r.relationship} required>
              {RELATIONSHIPS.map((x) => <option key={x} value={x}>{d.enums.relationship[x]}</option>)}
            </Select>
            <Checkbox name="isPrimary" label={r.primary} />
            <Checkbox name="canPickUp" label={r.canPickUp} defaultChecked />
            <Checkbox name="receivesNotifications" label={r.notifications} defaultChecked />
          </ActionForm>
          <h4 className="mb-2 mt-5 text-sm font-semibold text-brand-navy">{r.links}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {links.data?.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span>{guardianName.get(l.guardian_id)} → {studentName.get(l.student_id)} ({d.enums.relationship[l.relationship]})</span>
                {l.is_primary && <Badge tone="green">{r.primary}</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader><CardTitle>{r.assignTeacher}</CardTitle></CardHeader>
          <ActionForm action={assignTeacher} submitLabel={d.common.create}>
            <Select name="teacherId" label={r.teacher} required>
              {teachers.data?.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </Select>
            <Select name="sectionId" label={r.section} required>{sectionOptions}</Select>
            <Select name="subjectId" label={r.subject} required>
              {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </Select>
            <Checkbox name="isClassTeacher" label={r.classTeacher} />
          </ActionForm>
          <h4 className="mb-2 mt-5 text-sm font-semibold text-brand-navy">{r.assignments}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {assignments.data?.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>{teacherName.get(a.teacher_id)} — {sectionLabel(a.section_id)} — {subjectName.get(a.subject_id)}</span>
                {a.is_class_teacher && <Badge tone="orange">{r.classTeacher}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
