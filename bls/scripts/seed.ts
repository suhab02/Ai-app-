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
import { createClient } from "@supabase/supabase-js";

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
];

async function main() {
  // Never import @supabase/ssr here: this script is Node-only tooling, not
  // part of the app bundle, and the service-role key must never touch a
  // cookie-aware client that could end up reused in a request context.
  const admin = createClient(url as string, serviceRoleKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  const results: { email: string; role: string; displayId: string | null; status: string }[] = [];

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

    results.push({
      email: demo.email,
      role: profile.role,
      displayId: profile.display_id,
      status: profile.status,
    });
  }

  console.log("\nDemo accounts ready (password for all: %s)\n", DEMO_PASSWORD);
  console.table(results);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
