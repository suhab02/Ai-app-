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

  console.log("\nSchool data ready: 2025-2026 / Class 5 (A, B) / 4 subjects / 2 students / 2 guardians / 2 teachers");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
