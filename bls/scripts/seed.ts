/**
 * Development seed script — creates one demo auth user per role so the five
 * role-based dashboards and the RLS smoke tests have something real to log
 * in as.
 *
 * Guarded by SEED_ENV=development so it can never be run against a
 * production project by accident (see docs/testing.md). Requires
 * SUPABASE_SERVICE_ROLE_KEY, which must only ever live in a local
 * .env.local / CI secret — never commit it, never ship it to the browser.
 *
 * Usage: SEED_ENV=development npm run seed
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

config({ path: ".env.local" });

if (process.env.SEED_ENV !== "development") {
  console.error(
    "Refusing to seed: set SEED_ENV=development explicitly.\n" +
      "  SEED_ENV=development npm run seed",
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill them in.",
  );
  process.exit(1);
}

const DEMO_PASSWORD = "Passw0rd!23";

const DEMO_USERS = [
  { email: "admin@brightlearning.test", fullName: "Amina Rahman", role: "SUPER_ADMIN" as const },
  { email: "organizer@brightlearning.test", fullName: "Farhan Kabir", role: "ORGANIZER" as const },
  { email: "teacher@brightlearning.test", fullName: "Nusrat Jahan", role: "TEACHER" as const },
  { email: "student@brightlearning.test", fullName: "Tanvir Ahmed", role: "STUDENT" as const },
  { email: "parent@brightlearning.test", fullName: "Shirin Akter", role: "PARENT" as const },
  { email: "student2@brightlearning.test", fullName: "Rafi Hasan", role: "STUDENT" as const },
  { email: "parent2@brightlearning.test", fullName: "Kamal Hasan", role: "PARENT" as const },
  { email: "teacher2@brightlearning.test", fullName: "Imran Hossain", role: "TEACHER" as const },
];

async function main() {
  // Never import @supabase/ssr here: this script is Node-only tooling, not
  // part of the app bundle, and the service-role key must never touch a
  // cookie-aware client that could end up reused in a request context.
  const admin = createClient<Database>(url as string, serviceRoleKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  const results: { email: string; role: string; displayId: string | null; status: string }[] = [];
  const profileIds: Record<string, string> = {};

  for (const demo of DEMO_USERS) {
    let userId = existing.users.find((u) => u.email === demo.email)?.id;

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: demo.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: demo.fullName },
      });
      if (error) throw error;
      userId = data.user.id;
      console.log(`Created auth user ${demo.email}`);
    } else {
      console.log(`Auth user ${demo.email} already exists, reusing`);
    }

    // The auth trigger always inserts STUDENT/PENDING first; this is the
    // deliberate service_role-only elevation path described in
    // supabase/migrations/0002_rls.sql, exercised here for every non-default
    // demo role (and to activate all five demo accounts).
    const { data: profile, error: updateError } = await admin
      .from("profiles")
      .update({ role: demo.role, status: "ACTIVE" })
      .eq("id", userId)
      .select("display_id, role, status")
      .single();

    if (updateError) throw updateError;
    profileIds[demo.email] = userId;

    results.push({
      email: demo.email,
      role: profile.role,
      displayId: profile.display_id,
      status: profile.status,
    });
  }

  console.log("\nDemo accounts ready (password for all: %s)\n", DEMO_PASSWORD);
  console.table(results);

  await seedSchoolData(admin, profileIds);
}

type Admin = SupabaseClient<Database>;

async function must<T>(label: string, result: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await result;
  if (error || data === null || data === undefined) throw new Error(`${label}: ${error?.message ?? "no data returned"}`);
  return data as NonNullable<T>;
}

/**
 * Phase 2 sample data. Every write is an upsert on a natural unique key (or a
 * check-then-insert where only a partial index exists), so re-running the seed
 * never duplicates rows.
 *
 * Shape: Class 5 has sections A and B. Tanvir (student) is in 5-A with parent
 * Shirin; Rafi (student2) is in 5-B with parent Kamal; teacher Nusrat teaches
 * 5-A only. That gives every isolation test a positive and a negative case.
 */
async function seedSchoolData(admin: Admin, profileIds: Record<string, string>) {
  const year = await must(
    "academic year",
    admin
      .from("academic_years")
      .upsert(
        { name: "2025-2026", start_date: "2025-01-01", end_date: "2025-12-31", is_current: true },
        { onConflict: "name" },
      )
      .select("id")
      .single(),
  );

  const cls = await must(
    "class",
    admin
      .from("classes")
      .upsert(
        { academic_year_id: year.id, name: "Class 5", name_bn: "পঞ্চম শ্রেণি", order_index: 5 },
        { onConflict: "academic_year_id,name" },
      )
      .select("id")
      .single(),
  );

  const sections: Record<string, string> = {};
  for (const name of ["A", "B"]) {
    const row = await must(
      `section ${name}`,
      admin
        .from("sections")
        .upsert({ class_id: cls.id, name, name_bn: name === "A" ? "ক" : "খ", capacity: 40 }, { onConflict: "class_id,name" })
        .select("id")
        .single(),
    );
    sections[name] = row.id;
  }

  const subjects: Record<string, string> = {};
  for (const [code, name, nameBn] of [
    ["MATH", "Mathematics", "গণিত"],
    ["ENG", "English", "ইংরেজি"],
    ["BAN", "Bangla", "বাংলা"],
    ["SCI", "Science", "বিজ্ঞান"],
  ]) {
    const row = await must(
      `subject ${code}`,
      admin.from("subjects").upsert({ code, name, name_bn: nameBn }, { onConflict: "code" }).select("id").single(),
    );
    subjects[code] = row.id;
  }

  const studentPeople = [
    { email: "student@brightlearning.test", admission: "BLS-ADM-0001", name: "Tanvir Ahmed", nameBn: "তানভীর আহমেদ", section: "A", roll: "1" },
    { email: "student2@brightlearning.test", admission: "BLS-ADM-0002", name: "Rafi Hasan", nameBn: "রাফি হাসান", section: "B", roll: "1" },
  ];
  const studentIds: Record<string, string> = {};
  for (const s of studentPeople) {
    const row = await must(
      `student ${s.admission}`,
      admin
        .from("students")
        .upsert(
          {
            profile_id: profileIds[s.email],
            admission_number: s.admission,
            full_name: s.name,
            full_name_bn: s.nameBn,
            gender: "MALE" as const,
            nationality: "Bangladeshi",
          },
          { onConflict: "admission_number" },
        )
        .select("id")
        .single(),
    );
    studentIds[s.email] = row.id;

    const { data: existing, error } = await admin
      .from("student_enrollments")
      .select("id")
      .eq("student_id", row.id)
      .eq("academic_year_id", year.id)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw error;
    if (!existing) {
      const { error: insertError } = await admin.from("student_enrollments").insert({
        student_id: row.id,
        academic_year_id: year.id,
        class_id: cls.id,
        section_id: sections[s.section],
        roll_number: s.roll,
      });
      if (insertError) throw insertError;
    }
  }

  const guardianPeople = [
    { email: "parent@brightlearning.test", name: "Shirin Akter", nameBn: "শিরিন আক্তার", child: "student@brightlearning.test", relationship: "MOTHER" as const },
    { email: "parent2@brightlearning.test", name: "Kamal Hasan", nameBn: "কামাল হাসান", child: "student2@brightlearning.test", relationship: "FATHER" as const },
  ];
  for (const g of guardianPeople) {
    const row = await must(
      `guardian ${g.email}`,
      admin
        .from("guardians")
        .upsert({ profile_id: profileIds[g.email], full_name: g.name, full_name_bn: g.nameBn }, { onConflict: "profile_id" })
        .select("id")
        .single(),
    );
    const { error } = await admin
      .from("student_guardians")
      .upsert(
        { student_id: studentIds[g.child], guardian_id: row.id, relationship: g.relationship, is_primary: true },
        { onConflict: "student_id,guardian_id" },
      );
    if (error) throw error;
  }

  const teacherPeople = [
    { email: "teacher@brightlearning.test", name: "Nusrat Jahan", nameBn: "নুসরাত জাহান", assign: true },
    { email: "teacher2@brightlearning.test", name: "Imran Hossain", nameBn: "ইমরান হোসেন", assign: false },
  ];
  let assignedTeacherId: string | undefined;
  for (const t of teacherPeople) {
    const row = await must(
      `teacher ${t.email}`,
      admin
        .from("teachers")
        .upsert(
          { profile_id: profileIds[t.email], full_name: t.name, full_name_bn: t.nameBn, designation: "Assistant Teacher" },
          { onConflict: "profile_id" },
        )
        .select("id")
        .single(),
    );
    if (!t.assign) continue;
    assignedTeacherId = row.id;
    for (const code of ["MATH", "ENG"]) {
      const { error } = await admin.from("teacher_assignments").upsert(
        {
          teacher_id: row.id,
          academic_year_id: year.id,
          class_id: cls.id,
          section_id: sections.A,
          subject_id: subjects[code],
          is_class_teacher: code === "MATH",
        },
        { onConflict: "teacher_id,academic_year_id,class_id,section_id,subject_id" },
      );
      if (error) throw error;
    }
  }

  await seedAttendanceAndHomework({ admin, yearId: year.id, classId: cls.id, sections, subjects, studentIds, teacherId: assignedTeacherId });
  await seedTimetable({ admin, yearId: year.id, classId: cls.id, sectionId: sections.A, subjects, teacherId: assignedTeacherId });
  await seedFees({ admin, yearId: year.id, studentIds });
  await seedAssessments({ admin, yearId: year.id, classId: cls.id, sectionId: sections.A, subjects, studentId: studentIds["student@brightlearning.test"] });

  console.log("\nSchool data ready: 2025-2026 / Class 5 (A, B) / 4 subjects / 2 students / 2 guardians / 2 teachers");
}


/** Dhaka calendar date `offset` days from today (school runs on Asia/Dhaka, UTC+6). */
function schoolDate(offset: number): string {
  return new Date(Date.now() + 6 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
}

/**
 * Phase 3 sample data: five days of attendance for both students and two
 * homework items for 5-A. Upserts / check-then-insert, so re-running is safe.
 */
async function seedAttendanceAndHomework(args: {
  admin: Admin;
  yearId: string;
  classId: string;
  sections: Record<string, string>;
  subjects: Record<string, string>;
  studentIds: Record<string, string>;
  teacherId: string | undefined;
}) {
  const { admin, yearId, classId, sections, subjects, studentIds, teacherId } = args;

  const patterns = [
    { email: "student@brightlearning.test", section: "A", statuses: ["PRESENT", "PRESENT", "LATE", "ABSENT", "PRESENT"] as const },
    { email: "student2@brightlearning.test", section: "B", statuses: ["PRESENT", "LEAVE", "PRESENT", "PRESENT", "EXCUSED"] as const },
  ];
  for (const p of patterns) {
    for (const [i, status] of p.statuses.entries()) {
      const { error } = await admin.from("attendance_records").upsert(
        {
          student_id: studentIds[p.email],
          academic_year_id: yearId,
          class_id: classId,
          section_id: sections[p.section],
          attendance_date: schoolDate(-(p.statuses.length - i)),
          status,
        },
        { onConflict: "student_id,attendance_date" },
      );
      if (error) throw error;
    }
  }

  const items = [
    { code: "MATH", title: "Chapter 3 exercises 1–10", description: "Show your working.", due: schoolDate(2) },
    { code: "ENG", title: "Write a paragraph about your school", description: "Around 100 words.", due: schoolDate(4) },
  ];
  for (const item of items) {
    const { data: existing, error } = await admin
      .from("homework")
      .select("id")
      .eq("section_id", sections.A)
      .eq("subject_id", subjects[item.code])
      .eq("title", item.title)
      .maybeSingle();
    if (error) throw error;
    if (existing) continue;
    const { error: insertError } = await admin.from("homework").insert({
      academic_year_id: yearId,
      class_id: classId,
      section_id: sections.A,
      subject_id: subjects[item.code],
      teacher_id: teacherId ?? null,
      title: item.title,
      description: item.description,
      due_date: item.due,
    });
    if (insertError) throw insertError;
  }

  console.log("Attendance (5 days x 2 students) and 2 homework items ready");
}


/**
 * Phase 4 sample data for 5-A: two PUBLISHED term-1 assessments (so the student/parent
 * results and report card have content) and one unpublished monthly exam with marks
 * (so you can see it stays hidden from students until the teacher publishes it).
 */
async function seedAssessments(args: {
  admin: Admin;
  yearId: string;
  classId: string;
  sectionId: string;
  subjects: Record<string, string>;
  studentId: string;
}) {
  const { admin, yearId, classId, sectionId, subjects, studentId } = args;
  const items = [
    { code: "MATH", name: "Class Test 1", kind: "CLASS_TEST" as const, term: "Term 1", max: 50, marks: 42, published: true },
    { code: "ENG", name: "Class Test 1", kind: "CLASS_TEST" as const, term: "Term 1", max: 50, marks: 38, published: true },
    { code: "MATH", name: "Monthly Exam (draft)", kind: "MONTHLY" as const, term: "Term 1", max: 100, marks: 77, published: false },
  ];
  for (const item of items) {
    const { data: existing, error } = await admin
      .from("assessments")
      .select("id")
      .eq("section_id", sectionId)
      .eq("subject_id", subjects[item.code])
      .eq("name", item.name)
      .maybeSingle();
    if (error) throw error;

    let assessmentId = existing?.id;
    if (!assessmentId) {
      const created = await must(
        `assessment ${item.name}`,
        admin
          .from("assessments")
          .insert({
            academic_year_id: yearId,
            class_id: classId,
            section_id: sectionId,
            subject_id: subjects[item.code],
            kind: item.kind,
            name: item.name,
            term: item.term,
            max_marks: item.max,
            assessment_date: schoolDate(-3),
            is_published: false,
          })
          .select("id")
          .single(),
      );
      assessmentId = created.id;
    }

    // Results first, publish last: a published assessment is frozen for non-staff writers.
    const { error: resultError } = await admin
      .from("assessment_results")
      .upsert({ assessment_id: assessmentId, student_id: studentId, marks_obtained: item.marks, is_absent: false }, { onConflict: "assessment_id,student_id" });
    if (resultError) throw resultError;

    if (item.published) {
      const { error: publishError } = await admin.from("assessments").update({ is_published: true }).eq("id", assessmentId);
      if (publishError) throw publishError;
    }
  }
  console.log("Assessments ready (2 published, 1 draft) for 5-A");
}


/** Phase 5 sample data: three periods, a recess, and a Sunday–Tuesday Math/English timetable for 5-A. */
async function seedTimetable(args: {
  admin: Admin;
  yearId: string;
  classId: string;
  sectionId: string;
  subjects: Record<string, string>;
  teacherId: string | undefined;
}) {
  const { admin, yearId, classId, sectionId, subjects, teacherId } = args;

  const periodDefs = [
    { period_no: 1, label: "Period 1", start_time: "09:00", end_time: "09:45", is_break: false },
    { period_no: 2, label: "Period 2", start_time: "09:50", end_time: "10:35", is_break: false },
    { period_no: 3, label: "Recess", start_time: "10:35", end_time: "11:00", is_break: true },
    { period_no: 4, label: "Period 3", start_time: "11:00", end_time: "11:45", is_break: false },
  ];
  const periodIds: Record<number, string> = {};
  for (const def of periodDefs) {
    const row = await must(
      `period ${def.period_no}`,
      admin.from("timetable_periods").upsert(def, { onConflict: "period_no" }).select("id").single(),
    );
    periodIds[def.period_no] = row.id;
  }

  // weekday 0 = Sunday. Both MATH and ENG are assigned to the seeded teacher for 5-A.
  const lessons = [
    { weekday: 0, period: 1, subject: "MATH", room: "101" },
    { weekday: 0, period: 2, subject: "ENG", room: "101" },
    { weekday: 1, period: 1, subject: "BAN", room: "101" },
    { weekday: 1, period: 2, subject: "MATH", room: "101" },
    { weekday: 2, period: 1, subject: "SCI", room: "Lab" },
    { weekday: 2, period: 4, subject: "ENG", room: "101" },
  ];
  for (const l of lessons) {
    const teaches = l.subject === "MATH" || l.subject === "ENG";
    const { error } = await admin.from("timetable_entries").upsert(
      {
        academic_year_id: yearId,
        class_id: classId,
        section_id: sectionId,
        weekday: l.weekday,
        period_id: periodIds[l.period],
        subject_id: subjects[l.subject],
        teacher_id: teaches ? (teacherId ?? null) : null,
        room: l.room,
      },
      { onConflict: "section_id,weekday,period_id" },
    );
    if (error) throw error;
  }
  console.log("Timetable ready (4 periods, 6 lessons) for 5-A");
}


/**
 * Phase 6 sample data: a Tuition fee type, Tanvir's invoice (৳2,000, part-paid ৳1,200 in cash)
 * and Rafi's invoice (৳1,500, unpaid). The payment goes through the same ledger triggers as the
 * app: its receipt number is generated by the database, not chosen here.
 */
async function seedFees(args: { admin: Admin; yearId: string; studentIds: Record<string, string> }) {
  const { admin, yearId, studentIds } = args;

  const feeType = await must(
    "fee type",
    admin.from("fee_types").upsert({ code: "TUITION", name: "Tuition fee", name_bn: "টিউশন ফি" }, { onConflict: "code" }).select("id").single(),
  );

  const invoices = [
    { email: "student@brightlearning.test", description: "Monthly tuition", amount: 2000, paid: 1200 },
    { email: "student2@brightlearning.test", description: "Monthly tuition", amount: 1500, paid: 0 },
  ];
  for (const inv of invoices) {
    const studentId = studentIds[inv.email];
    const { data: existing, error } = await admin
      .from("invoices")
      .select("id")
      .eq("student_id", studentId)
      .eq("fee_type_id", feeType.id)
      .eq("description", inv.description)
      .maybeSingle();
    if (error) throw error;

    const invoiceId =
      existing?.id ??
      (
        await must(
          "invoice",
          admin
            .from("invoices")
            .insert({
              student_id: studentId,
              academic_year_id: yearId,
              fee_type_id: feeType.id,
              description: inv.description,
              amount_due: inv.amount,
              due_date: schoolDate(7),
            })
            .select("id")
            .single(),
        )
      ).id;

    if (inv.paid > 0) {
      const { count, error: countError } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
      if (countError) throw countError;
      if (!count) {
        const { error: payError } = await admin
          .from("payments")
          .insert({ invoice_id: invoiceId, amount: inv.paid, method: "CASH", status: "PAID", notes: "Seed data" });
        if (payError) throw payError;
      }
    }
  }
  console.log("Fees ready (Tuition: Tanvir part-paid, Rafi unpaid)");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
