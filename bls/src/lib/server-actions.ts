import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok?: string; error?: string } | undefined;
export type Db = Awaited<ReturnType<typeof createClient>>;
export type DbError = { code?: string; message: string };

/** FormData → plain string record (files are ignored). */
export function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Maps Postgres/PostgREST errors to something a staff member can act on. */
export function friendly(error: DbError): string {
  if (error.code === "23505") return "That value already exists.";
  if (error.code === "23503") return "A referenced record does not exist.";
  if (error.code === "42501") return "You are not allowed to do that.";
  return error.message;
}

export function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}
