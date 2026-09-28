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
