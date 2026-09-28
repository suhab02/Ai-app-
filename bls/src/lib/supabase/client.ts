"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/** Browser Supabase client. Uses only the public URL and anon key. */
export function createClient() {
  return createBrowserClient<Database>(getSupabaseUrl(), getSupabaseAnonKey());
}
