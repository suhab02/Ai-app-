import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Server Supabase client for Server Components, Server Actions and Route
 * Handlers. Only ever uses the public anon key — RLS is what makes this
 * safe, never the choice of key.
 *
 * Writing cookies from a Server Component throws (Next.js only allows cookie
 * writes from Server Actions / Route Handlers); that's expected and safe to
 * swallow here because `proxy.ts` refreshes the session cookie on every
 * navigation anyway.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — ignored, see doc comment above.
        }
      },
    },
  });
}
