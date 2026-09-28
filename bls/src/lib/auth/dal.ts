import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow, UserRole } from "@/lib/supabase/types";

/**
 * Data Access Layer — the one place Server Components/Actions/Route
 * Handlers go to find out who is calling and what they're allowed to see.
 * `proxy.ts` only does optimistic redirects; this is the real check, backed
 * by a verified JWT and, for every row it returns, Postgres RLS underneath.
 * `cache()` de-dupes repeated calls within a single render pass.
 */
export const verifySession = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  return { userId: data.claims.sub as string };
});

/** Returns the caller's profile row, or null if they have none (should not
 * happen once the auth trigger runs, but the DB is always the source of
 * truth over any assumption made here). Requires an authenticated session. */
export const getCurrentProfile = cache(async (): Promise<ProfileRow | null> => {
  const { userId } = await verifySession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  return data;
});

/**
 * Redirects home if the caller's profile is missing or their role isn't in
 * `allowed`. Use in Server Components for role-gated pages/sections — never
 * trust a role passed from the client instead.
 */
export async function requireRole(allowed: UserRole[]): Promise<ProfileRow> {
  const profile = await getCurrentProfile();

  if (!profile || !allowed.includes(profile.role)) {
    redirect("/dashboard");
  }

  return profile;
}

/** SUPER_ADMIN or ORGANIZER only. Call first in every admin page and Server Action. */
export async function requireStaff(): Promise<ProfileRow> {
  return requireRole(["SUPER_ADMIN", "ORGANIZER"]);
}
