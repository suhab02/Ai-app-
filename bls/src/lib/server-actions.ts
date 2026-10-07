import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireStaff } from "@/lib/auth/dal";
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

/**
 * The standard staff-only write: role guard → Zod → one database operation → revalidate.
 * The database (RLS + triggers) is the final gate; a forged post from a non-staff account
 * fails at requireStaff() and again at RLS.
 */
export async function runStaff<S extends z.ZodType>(
  formData: FormData,
  schema: S,
  paths: string[],
  message: string,
  op: (input: z.output<S>, db: Db) => PromiseLike<{ error: DbError | null }>,
): Promise<ActionResult> {
  await requireStaff();

  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) return { error: zodMessage(parsed.error) };

  const db = await createClient();
  const { error } = await op(parsed.data, db);
  if (error) return { error: friendly(error) };

  for (const path of paths) revalidatePath(path);
  return { ok: message };
}
