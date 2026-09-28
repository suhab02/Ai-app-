import { getCurrentProfile } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import type { UserRole } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/server";
import { getSectionLabeler } from "@/lib/school/labels";

type DomainKey = keyof Dictionary["domain"];

// What each role will eventually manage or see (Phase 2+). Phase 1 only
// proves the role reaches the right shell with the right scope — the actual
// data views land module by module.
// Modules that exist now; the rest still show "coming soon".
const LIVE_MODULES: Partial<Record<DomainKey, string>> = {
  attendance: "/dashboard/attendance",
  homework: "/dashboard/homework",
};

const ROLE_MODULES: Record<UserRole, DomainKey[]> = {
  SUPER_ADMIN: [
    "students",
    "teachers",
    "guardians",
    "attendance",
    "homework",
    "results",
    "timetable",
    "fees",
    "payments",
    "notices",
    "events",
    "gallery",
  ],
  ORGANIZER: [
    "students",
    "teachers",
    "guardians",
    "attendance",
    "homework",
    "results",
    "timetable",
    "fees",
    "payments",
    "notices",
    "events",
    "gallery",
  ],
  TEACHER: ["attendance", "homework", "results", "timetable"],
  STUDENT: ["attendance", "homework", "results", "timetable", "notices", "events", "fees"],
  PARENT: ["attendance", "homework", "results", "notices", "events", "fees", "payments"],
};


// Every query below runs as the signed-in user, so RLS decides what comes back:
// a student gets their own enrollment, a guardian their linked children, a
// teacher their assigned class-sections and those students only.
async function StudentPanel({ dictionary }: { dictionary: Dictionary }) {
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const { data } = await db
    .from("student_enrollments")
    .select("*")
    .eq("status", "ACTIVE")
    .order("start_date", { ascending: false })
    .limit(1);
  const enrollment = data?.[0];

  return (
    <Card>
      <CardHeader><CardTitle>{dictionary.dashboard.myClass}</CardTitle></CardHeader>
      {enrollment ? (
        <p className="text-sm text-slate-700">
          {label(enrollment.section_id)}
          {enrollment.roll_number ? ` · ${dictionary.dashboard.roll} ${enrollment.roll_number}` : ""}
        </p>
      ) : (
        <p className="text-sm text-slate-500">{dictionary.dashboard.noEnrollment}</p>
      )}
    </Card>
  );
}

async function ParentPanel({ dictionary }: { dictionary: Dictionary }) {
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const [students, enrollments] = await Promise.all([
    db.from("students").select("id, full_name, admission_number").order("full_name"),
    db.from("student_enrollments").select("student_id, section_id, roll_number").eq("status", "ACTIVE"),
  ]);
  const enrollmentByStudent = new Map(enrollments.data?.map((e) => [e.student_id, e]));

  return (
    <Card>
      <CardHeader><CardTitle>{dictionary.dashboard.myChildren}</CardTitle></CardHeader>
      {students.data?.length ? (
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          {students.data.map((s) => {
            const e = enrollmentByStudent.get(s.id);
            return (
              <li key={s.id}>
                <span className="font-medium text-brand-navy">{s.full_name}</span>{" "}
                <span className="font-mono text-slate-400">{s.admission_number}</span>
                {e && <div className="text-slate-500">{label(e.section_id)}{e.roll_number ? ` · ${dictionary.dashboard.roll} ${e.roll_number}` : ""}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{dictionary.dashboard.noChildren}</p>
      )}
    </Card>
  );
}

async function TeacherPanel({ dictionary }: { dictionary: Dictionary }) {
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const [assignments, subjects, students, enrollments] = await Promise.all([
    db.from("teacher_assignments").select("*"),
    db.from("subjects").select("id, name"),
    db.from("students").select("id, full_name").order("full_name"),
    db.from("student_enrollments").select("student_id, section_id").eq("status", "ACTIVE"),
  ]);
  const subjectName = new Map(subjects.data?.map((s) => [s.id, s.name]));
  const studentName = new Map(students.data?.map((s) => [s.id, s.full_name]));

  return (
    <Card>
      <CardHeader><CardTitle>{dictionary.dashboard.myClasses}</CardTitle></CardHeader>
      {assignments.data?.length ? (
        <ul className="flex flex-col gap-3 text-sm text-slate-700">
          {assignments.data.map((a) => (
            <li key={a.id}>
              <span className="font-medium text-brand-navy">{label(a.section_id)}</span> · {subjectName.get(a.subject_id)}
              {a.is_class_teacher && <Badge tone="orange" className="ml-2">{dictionary.dashboard.classTeacher}</Badge>}
            </li>
          ))}
          <li className="border-t border-slate-100 pt-3">
            <span className="font-medium text-brand-navy">{dictionary.dashboard.studentsInClass}: </span>
            {enrollments.data?.map((e) => studentName.get(e.student_id)).filter(Boolean).join(", ")}
          </li>
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{dictionary.dashboard.noAssignments}</p>
      )}
    </Card>
  );
}

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const dictionary = getDictionary(await getLocale());
  const modules = ROLE_MODULES[profile.role];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-brand-navy">
              {dictionary.dashboard.welcome.replace("{name}", profile.full_name ?? profile.email ?? "")}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {dictionary.dashboard.yourId}: <span className="font-mono">{profile.display_id}</span>
            </p>
          </div>
          <Badge tone="green">{dictionary.roles[profile.role]}</Badge>
        </div>
      </Card>

      {profile.role === "STUDENT" && <StudentPanel dictionary={dictionary} />}
      {profile.role === "PARENT" && <ParentPanel dictionary={dictionary} />}
      {profile.role === "TEACHER" && <TeacherPanel dictionary={dictionary} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((key) => {
          const href = LIVE_MODULES[key];
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle>{dictionary.domain[key]}</CardTitle>
              </CardHeader>
              {href ? (
                <Link href={href} className="text-sm font-medium text-brand-green hover:underline">
                  {dictionary.dashboard.open} →
                </Link>
              ) : (
                <p className="text-sm text-slate-500">{dictionary.dashboard.comingSoon}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
