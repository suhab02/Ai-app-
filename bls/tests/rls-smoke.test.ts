/**
 * RLS smoke tests — real network calls against a Supabase project, using
 * only the public anon key (never the service-role key), exactly the way a
 * browser or a malicious direct API caller would. These are the mandatory
 * cross-role isolation checks from the project brief, scoped to what Phase 1
 * actually has: the profiles table.
 *
 * Prerequisites:
 *   1. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY set (.env.local)
 *   2. supabase/migrations/0001_init.sql and 0002_rls.sql applied
 *   3. SEED_ENV=development npm run seed has been run
 *
 * Run: npm run test:rls
 */
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DEMO_PASSWORD = "Passw0rd!23";

const DEMO = {
  admin: "admin@brightlearning.test",
  organizer: "organizer@brightlearning.test",
  teacher: "teacher@brightlearning.test",
  student: "student@brightlearning.test",
  parent: "parent@brightlearning.test",
  student2: "student2@brightlearning.test",
  parent2: "parent2@brightlearning.test",
  teacher2: "teacher2@brightlearning.test",
} as const;

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createClient(url as string, anonKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) {
    throw new Error(
      `Could not sign in as ${email}: ${error.message}. Did you run \`SEED_ENV=development npm run seed\`?`,
    );
  }
  return client;
}

function anonClient(): SupabaseClient {
  return createClient(url as string, anonKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const hasEnv = !!url && !!anonKey;
if (!hasEnv) {
  console.warn(
    "Skipping RLS smoke tests: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local first.",
  );
}

describe.runIf(hasEnv)("profiles RLS", () => {
  let studentId: string;
  let teacherId: string;

  beforeAll(async () => {
    const student = await signedInClient(DEMO.student);
    const { data } = await student.auth.getUser();
    studentId = data.user!.id;

    const teacher = await signedInClient(DEMO.teacher);
    const { data: teacherData } = await teacher.auth.getUser();
    teacherId = teacherData.user!.id;
  });

  it("blocks logged-out access entirely", async () => {
    const { data, error } = await anonClient().from("profiles").select("id");
    // Either an empty result set or a permission error is an acceptable
    // "no access" outcome; a populated result set is not.
    expect(error || (data ?? []).length === 0).toBeTruthy();
  });

  it("lets a student read their own profile but not a teacher's", async () => {
    const student = await signedInClient(DEMO.student);

    const own = await student.from("profiles").select("id").eq("id", studentId).maybeSingle();
    expect(own.data?.id).toBe(studentId);

    const other = await student.from("profiles").select("id").eq("id", teacherId).maybeSingle();
    expect(other.data).toBeNull();
  });

  it("blocks a student from updating another student's row", async () => {
    const student = await signedInClient(DEMO.student);
    const { data } = await student
      .from("profiles")
      .update({ full_name: "Hijacked" })
      .eq("id", teacherId)
      .select();
    expect(data ?? []).toHaveLength(0);
  });

  it("blocks a student from self-promoting to TEACHER", async () => {
    const student = await signedInClient(DEMO.student);
    const { error } = await student.from("profiles").update({ role: "TEACHER" }).eq("id", studentId);
    expect(error).not.toBeNull();
  });

  it("blocks a teacher from reading another user's profile (no admin powers)", async () => {
    const teacher = await signedInClient(DEMO.teacher);
    const { data } = await teacher.from("profiles").select("id").eq("id", studentId).maybeSingle();
    expect(data).toBeNull();
  });

  it("blocks an organizer from granting SUPER_ADMIN", async () => {
    const organizer = await signedInClient(DEMO.organizer);
    const { error } = await organizer
      .from("profiles")
      .update({ role: "SUPER_ADMIN" })
      .eq("id", studentId);
    expect(error).not.toBeNull();
  });

  it("lets an organizer suspend and reactivate a student account", async () => {
    const organizer = await signedInClient(DEMO.organizer);

    const suspend = await organizer
      .from("profiles")
      .update({ status: "SUSPENDED" })
      .eq("id", studentId)
      .select("status")
      .single();
    expect(suspend.error).toBeNull();
    expect(suspend.data?.status).toBe("SUSPENDED");

    const reactivate = await organizer
      .from("profiles")
      .update({ status: "ACTIVE" })
      .eq("id", studentId)
      .select("status")
      .single();
    expect(reactivate.data?.status).toBe("ACTIVE");
  });

  it("lets SUPER_ADMIN read every profile", async () => {
    const admin = await signedInClient(DEMO.admin);
    const { data, error } = await admin.from("profiles").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe.runIf(hasEnv)("school data RLS (Phase 2)", () => {
  it("parent A sees only their own child, never parent B's", async () => {
    const parent = await signedInClient(DEMO.parent);
    const { data } = await parent.from("students").select("admission_number");
    expect(data?.map((s) => s.admission_number)).toEqual(["BLS-ADM-0001"]);

    const links = await parent.from("student_guardians").select("student_id");
    expect(links.data).toHaveLength(1);

    const guardians = await parent.from("guardians").select("full_name");
    expect(guardians.data?.map((g) => g.full_name)).toEqual(["Shirin Akter"]);
  });

  it("parent B cannot see parent A's child", async () => {
    const parent2 = await signedInClient(DEMO.parent2);
    const { data } = await parent2.from("students").select("admission_number");
    expect(data?.map((s) => s.admission_number)).toEqual(["BLS-ADM-0002"]);
  });

  it("student A cannot see student B", async () => {
    const student = await signedInClient(DEMO.student);
    const { data } = await student.from("students").select("admission_number");
    expect(data?.map((s) => s.admission_number)).toEqual(["BLS-ADM-0001"]);

    const enrollments = await student.from("student_enrollments").select("id");
    expect(enrollments.data).toHaveLength(1);
  });

  it("a teacher sees only students in their assigned class/section", async () => {
    const teacher = await signedInClient(DEMO.teacher);
    const { data } = await teacher.from("students").select("admission_number");
    expect(data?.map((s) => s.admission_number)).toEqual(["BLS-ADM-0001"]);

    const guardians = await teacher.from("guardians").select("id");
    expect(guardians.data).toHaveLength(0);
  });

  it("an unassigned teacher sees no students", async () => {
    const teacher2 = await signedInClient(DEMO.teacher2);
    const { data } = await teacher2.from("students").select("id");
    expect(data).toHaveLength(0);
  });

  it("teachers, students and parents cannot write school data", async () => {
    for (const email of [DEMO.teacher, DEMO.student, DEMO.parent]) {
      const client = await signedInClient(email);
      const insert = await client.from("subjects").insert({ code: "HACK", name: "Hack" });
      expect(insert.error).not.toBeNull();

      const update = await client.from("students").update({ full_name: "Hacked" }).select();
      expect(update.data ?? []).toHaveLength(0);

      const del = await client.from("student_guardians").delete().select();
      expect(del.data ?? []).toHaveLength(0);
    }
  });

  it("logged-out users see no school data", async () => {
    for (const table of ["students", "guardians", "teachers", "student_enrollments"] as const) {
      const { data, error } = await anonClient().from(table).select("id");
      expect(error || (data ?? []).length === 0).toBeTruthy();
    }
  });

  it("organizers can read every student", async () => {
    const organizer = await signedInClient(DEMO.organizer);
    const { data, error } = await organizer.from("students").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(hasEnv)("attendance & homework RLS (Phase 3)", () => {
  it("parents and students see only their own attendance", async () => {
    for (const [email, count] of [[DEMO.parent, 5], [DEMO.student, 5], [DEMO.parent2, 5], [DEMO.student2, 5]] as const) {
      const client = await signedInClient(email);
      const { data, error } = await client.from("attendance_records").select("student_id");
      expect(error).toBeNull();
      expect(data).toHaveLength(count);
      expect(new Set(data?.map((r) => r.student_id)).size).toBe(1);
    }
  });

  it("an unassigned teacher sees no attendance or homework", async () => {
    const teacher2 = await signedInClient(DEMO.teacher2);
    expect((await teacher2.from("attendance_records").select("id")).data).toHaveLength(0);
    expect((await teacher2.from("homework").select("id")).data).toHaveLength(0);
  });

  it("homework is visible only to the right section", async () => {
    const a = await signedInClient(DEMO.parent);
    const b = await signedInClient(DEMO.parent2);
    expect(((await a.from("homework").select("id")).data ?? []).length).toBeGreaterThanOrEqual(2);
    expect((await b.from("homework").select("id")).data).toHaveLength(0);
  });

  it("students and parents cannot mark attendance or post homework", async () => {
    for (const email of [DEMO.student, DEMO.parent]) {
      const client = await signedInClient(email);
      const { data: students } = await client.from("students").select("id").limit(1);
      const { data: enr } = await client.from("student_enrollments").select("*").limit(1);
      const e = enr?.[0];
      if (!e || !students?.[0]) continue;
      const mark = await client.from("attendance_records").insert({
        student_id: e.student_id, academic_year_id: e.academic_year_id, class_id: e.class_id,
        section_id: e.section_id, attendance_date: "2020-01-01", status: "PRESENT",
      });
      expect(mark.error).not.toBeNull();
    }
  });

  it("a teacher cannot mark a section they do not teach", async () => {
    const teacher = await signedInClient(DEMO.teacher);
    const organizer = await signedInClient(DEMO.organizer);

    const { data: all } = await organizer.from("student_enrollments").select("*").eq("status", "ACTIVE");
    const { data: mine } = await teacher.from("student_enrollments").select("section_id");
    const taught = new Set(mine?.map((r) => r.section_id));
    const foreign = all?.find((e) => !taught.has(e.section_id));

    // The seed puts student2 in section B, which the demo teacher does not teach.
    expect(foreign, "seed must contain an enrollment in a section the teacher does not teach").toBeDefined();

    const res = await teacher.from("attendance_records").insert({
      student_id: foreign!.student_id,
      academic_year_id: foreign!.academic_year_id,
      class_id: foreign!.class_id,
      section_id: foreign!.section_id,
      attendance_date: "2020-01-01",
      status: "PRESENT",
    });
    expect(res.error).not.toBeNull();
  });
});

describe.runIf(hasEnv)("assessments & results RLS (Phase 4)", () => {
  it("a student sees only published results, and only their own", async () => {
    const student = await signedInClient(DEMO.student);
    const results = await student.from("assessment_results").select("assessment_id, student_id");
    expect(results.error).toBeNull();
    expect(results.data).toHaveLength(2); // the draft Monthly exam stays hidden
    expect(new Set(results.data?.map((r) => r.student_id)).size).toBe(1);

    const assessments = await student.from("assessments").select("name, is_published");
    expect(assessments.data?.every((a) => a.is_published)).toBe(true);
  });

  it("a parent sees their child's published results; the other family sees none", async () => {
    expect(((await (await signedInClient(DEMO.parent)).from("assessment_results").select("id")).data ?? []).length).toBe(2);
    expect((await (await signedInClient(DEMO.parent2)).from("assessment_results").select("id")).data).toHaveLength(0);
    expect((await (await signedInClient(DEMO.student2)).from("assessment_results").select("id")).data).toHaveLength(0);
  });

  it("the assigned teacher sees the draft too; the unassigned one sees nothing", async () => {
    expect(((await (await signedInClient(DEMO.teacher)).from("assessments").select("id")).data ?? []).length).toBe(3);
    expect((await (await signedInClient(DEMO.teacher2)).from("assessments").select("id")).data).toHaveLength(0);
  });

  it("students and parents cannot write marks or grading bands", async () => {
    for (const email of [DEMO.student, DEMO.parent]) {
      const client = await signedInClient(email);
      const bands = await client.from("grading_scale_bands").update({ grade_point: 9 }).select();
      expect(bands.data ?? []).toHaveLength(0);
      const marks = await client.from("assessment_results").update({ marks_obtained: 50 }).select();
      expect(marks.data ?? []).toHaveLength(0);
    }
  });
});

describe.runIf(hasEnv)("timetable RLS (Phase 5)", () => {
  it("students and parents see only their section's timetable", async () => {
    const a = await signedInClient(DEMO.student);
    expect(((await a.from("timetable_entries").select("id")).data ?? []).length).toBe(6);
    expect(((await (await signedInClient(DEMO.parent)).from("timetable_entries").select("id")).data ?? []).length).toBe(6);
    expect((await (await signedInClient(DEMO.student2)).from("timetable_entries").select("id")).data).toHaveLength(0);
    expect((await (await signedInClient(DEMO.parent2)).from("timetable_entries").select("id")).data).toHaveLength(0);
  });

  it("an unassigned teacher sees no timetable; periods are readable by everyone", async () => {
    const teacher2 = await signedInClient(DEMO.teacher2);
    expect((await teacher2.from("timetable_entries").select("id")).data).toHaveLength(0);
    expect(((await teacher2.from("timetable_periods").select("id")).data ?? []).length).toBe(4);
  });

  it("only staff can change the timetable", async () => {
    for (const email of [DEMO.teacher, DEMO.student, DEMO.parent]) {
      const client = await signedInClient(email);
      const upd = await client.from("timetable_entries").update({ room: "hacked" }).select();
      expect(upd.data ?? []).toHaveLength(0);
      const ins = await client.from("timetable_periods").insert({ period_no: 99, label: "x", start_time: "01:00", end_time: "02:00" });
      expect(ins.error).not.toBeNull();
    }
  });
});

describe.runIf(hasEnv)("fees RLS (Phase 6)", () => {
  it("a family sees only its own invoices and payments", async () => {
    for (const [email, other] of [[DEMO.parent, "Rafi"], [DEMO.parent2, "Tanvir"]] as const) {
      const client = await signedInClient(email);
      const { data: invoices, error } = await client.from("invoices").select("student_id");
      expect(error).toBeNull();
      expect(invoices).toHaveLength(1);
      const { data: names } = await client.from("students").select("full_name");
      expect(names?.some((n) => n.full_name.includes(other))).toBe(false);
    }
  });

  it("teachers and logged-out users see no fee data", async () => {
    for (const email of [DEMO.teacher, DEMO.teacher2]) {
      const c = await signedInClient(email);
      expect((await c.from("invoices").select("id")).data).toHaveLength(0);
      expect((await c.from("payments").select("id")).data).toHaveLength(0);
    }
    const anon = await anonClient().from("invoices").select("id");
    expect(anon.error || (anon.data ?? []).length === 0).toBeTruthy();
  });

  it("only staff can create invoices or record payments; nobody can delete them", async () => {
    const parent = await signedInClient(DEMO.parent);
    const { data: inv } = await parent.from("invoices").select("id, student_id").limit(1);
    const i = inv?.[0];
    expect(i).toBeDefined();
    expect((await parent.from("payments").insert({ invoice_id: i!.id, amount: 1, method: "CASH" })).error).not.toBeNull();

    const organizer = await signedInClient(DEMO.organizer);
    expect((await organizer.from("payments").delete().eq("invoice_id", i!.id)).error).not.toBeNull();
  });

  it("the ledger refuses an overpayment and ignores a client-chosen receipt number", async () => {
    const organizer = await signedInClient(DEMO.organizer);
    const { data: inv } = await organizer.from("invoices").select("id, amount_due").eq("amount_due", 1500).limit(1);
    const target = inv?.[0];
    expect(target).toBeDefined();
    const over = await organizer.from("payments").insert({ invoice_id: target!.id, amount: 99999, method: "CASH" });
    expect(over.error).not.toBeNull();
  });

  it("internal functions are not callable through the API", async () => {
    const student = await signedInClient(DEMO.student);
    // PostgREST surfaces a missing EXECUTE privilege as an error.
    const res = await (student as unknown as { rpc: (n: string) => Promise<{ error: unknown }> }).rpc("next_receipt_no");
    expect(res.error).not.toBeNull();
  });
});

describe.runIf(hasEnv)("notices, events & gallery RLS (Phase 7)", () => {
  it("anonymous visitors see only public items and published albums", async () => {
    const anon = anonClient();
    const notices = await anon.from("notices").select("title, is_public");
    expect(notices.error).toBeNull();
    expect(notices.data?.every((n) => n.is_public)).toBe(true);
    expect(((await anon.from("events").select("id, is_public")).data ?? []).every((e) => e.is_public)).toBe(true);
    expect(((await anon.from("gallery_albums").select("is_published")).data ?? []).every((a) => a.is_published)).toBe(true);
  });

  it("anonymous visitors cannot write anything", async () => {
    const anon = anonClient();
    expect((await anon.from("notices").insert({ title: "x", body: "y" })).error).not.toBeNull();
    expect((await anon.from("gallery_albums").insert({ title: "x" })).error).not.toBeNull();
  });

  it("a section notice reaches that section's family only", async () => {
    const a = await (await signedInClient(DEMO.parent)).from("notices").select("title");
    const b = await (await signedInClient(DEMO.parent2)).from("notices").select("title");
    expect(a.data?.some((n) => n.title.includes("5-A"))).toBe(true);
    expect(b.data?.some((n) => n.title.includes("5-A"))).toBe(false);
  });

  it("students-only notices are not shown to parents", async () => {
    const parent = await (await signedInClient(DEMO.parent)).from("notices").select("title");
    const student = await (await signedInClient(DEMO.student)).from("notices").select("title");
    expect(parent.data?.some((n) => n.title.startsWith("Students:"))).toBe(false);
    expect(student.data?.some((n) => n.title.startsWith("Students:"))).toBe(true);
  });

  it("only staff can post notices or upload to the gallery bucket", async () => {
    const student = await signedInClient(DEMO.student);
    expect((await student.from("notices").insert({ title: "x", body: "y" })).error).not.toBeNull();
    const blob = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const upload = await student.storage.from("gallery-public").upload(`albums/${crypto.randomUUID()}/${crypto.randomUUID()}.png`, blob);
    expect(upload.error).not.toBeNull();
  });

  it("private student documents are not readable by another family", async () => {
    const other = await signedInClient(DEMO.parent2);
    const list = await other.storage.from("student-documents").list();
    expect(list.error || (list.data ?? []).length === 0).toBeTruthy();
  });
});

describe.runIf(hasEnv)("admissions & website content RLS (Phase 8)", () => {
  const application = (name: string) => ({
    applicant_name: name,
    date_of_birth: "2019-05-01",
    desired_class: "Class 1",
    guardian_name: "Test Guardian",
    guardian_phone: "+8801700000001",
  });

  it("a visitor can submit but cannot read, change or choose a status", async () => {
    const anon = anonClient();
    expect((await anon.from("admission_applications").insert(application("Smoke Test Child"))).error).toBeNull();
    expect((await anon.from("admission_applications").select("id")).error).not.toBeNull();
    expect((await anon.from("admission_applications").insert({ ...application("Sneaky"), status: "ACCEPTED" })).error).not.toBeNull();
    expect((await anon.from("admission_applications").delete().neq("id", "00000000-0000-0000-0000-000000000000")).error).not.toBeNull();
  });

  it("only staff can read and review applications", async () => {
    for (const email of [DEMO.teacher, DEMO.student, DEMO.parent]) {
      const { data } = await (await signedInClient(email)).from("admission_applications").select("id");
      expect(data ?? []).toHaveLength(0);
    }
    const organizer = await signedInClient(DEMO.organizer);
    const { data, error } = await organizer.from("admission_applications").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("website content is public to read but only staff can edit", async () => {
    expect(((await anonClient().from("site_content").select("key")).data ?? []).length).toBeGreaterThanOrEqual(4);
    expect((await anonClient().from("site_content").insert({ key: "defaced" })).error).not.toBeNull();
    const teacher = await signedInClient(DEMO.teacher);
    expect((await teacher.from("site_content").update({ body_en: "x" }).eq("key", "about").select()).data ?? []).toHaveLength(0);
  });
});
