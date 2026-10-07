"use server";

import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { fields, runStaff, zodMessage, type ActionResult } from "@/lib/server-actions";
import { isIsoDate, schoolToday, shiftDate } from "@/lib/school/date";

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).optional().transform((v) => (v ? v : undefined));

const ApplicationSchema = z.object({
  applicantName: text(120).min(2, { error: "Enter the child's name." }),
  applicantNameBn: optional(120),
  dateOfBirth: z
    .string()
    .refine(isIsoDate, { error: "Enter the child's date of birth." })
    .refine((v) => v < shiftDate(schoolToday(), -365) && v > shiftDate(schoolToday(), -365 * 30), { error: "That date of birth does not look right." }),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("").transform(() => undefined)),
  desiredClass: text(60).min(1, { error: "Which class is the child applying for?" }),
  previousSchool: optional(200),
  guardianName: text(120).min(2, { error: "Enter the parent or guardian's name." }),
  guardianPhone: z.string().trim().regex(/^[0-9+() -]{6,30}$/, { error: "Enter a valid phone number." }),
  guardianEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { error: "Enter a valid email address." }),
  address: optional(500),
  message: optional(2000),
  // Honeypot: real people never see or fill this field; naive bots fill every input.
  website: z.string().optional(),
});

/**
 * PUBLIC action — no login required, so it trusts nothing. The database independently enforces the
 * same limits and, more importantly, that an applicant can only ever write the form's own fields
 * (column-level GRANT + INSERT policy): they cannot choose a status or set a reviewer.
 * A CAPTCHA/edge rate limit is the recommended next layer (see docs/deployment.md).
 */
export async function submitApplication(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = ApplicationSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const i = parsed.data;

  // Bots get the same friendly answer as people, and nothing is stored.
  if (i.website) return { ok: "Thank you. Your application has been received." };

  const db = await createClient();
  // No .select(): anonymous visitors have no read access, so the insert must not ask for the row back.
  const { error } = await db.from("admission_applications").insert({
    applicant_name: i.applicantName,
    applicant_name_bn: i.applicantNameBn ?? null,
    date_of_birth: i.dateOfBirth,
    gender: i.gender ?? null,
    desired_class: i.desiredClass,
    previous_school: i.previousSchool ?? null,
    guardian_name: i.guardianName,
    guardian_phone: i.guardianPhone,
    guardian_email: i.guardianEmail ?? null,
    address: i.address ?? null,
    message: i.message ?? null,
  });
  if (error) return { error: "We could not submit your application. Please check the details and try again." };

  return { ok: "Thank you. Your application has been received. The school office will contact you." };
}

const ReviewSchema = z.object({
  id: z.uuid(),
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"]),
  reviewNotes: optional(2000),
});

export async function updateApplication(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, ReviewSchema, ["/dashboard/admin/admissions"], "Application updated.", (i, db) =>
    db.from("admission_applications").update({ status: i.status, review_notes: i.reviewNotes ?? null }).eq("id", i.id),
  );
}
