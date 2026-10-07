"use server";

import * as z from "zod";
import { runStaff, type ActionResult } from "@/lib/server-actions";
import { isIsoDate } from "@/lib/school/date";
import { hasValidPrecision } from "./money";

// Every action is staff-only (runStaff → requireStaff) and the database re-checks everything that
// matters for a ledger: no overpayment, immutable amounts, server-generated receipt numbers,
// session-derived collected_by. Nothing below is trusted for those.

const optionalText = z.string().trim().max(500).optional().transform((v) => (v ? v : undefined));
const amount = z.coerce
  .number({ error: "Enter an amount." })
  .positive({ error: "Amount must be more than zero." })
  .max(9_999_999.99)
  .refine(hasValidPrecision, { error: "Use at most two decimal places." });

const FeeTypeSchema = z.object({
  code: z.string().trim().min(1, { error: "Enter a code." }).max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, { error: "Enter a name." }).max(80),
  nameBn: optionalText,
});

export async function createFeeType(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, FeeTypeSchema, ["/dashboard/fees"], "Fee type created.", (i, db) =>
    db.from("fee_types").insert({ code: i.code, name: i.name, name_bn: i.nameBn ?? null }),
  );
}

const InvoiceBase = z.object({
  feeTypeId: z.uuid({ error: "Choose a fee type." }),
  amount,
  dueDate: z.string().refine(isIsoDate, { error: "Choose a due date." }),
  description: optionalText,
});

const StudentInvoiceSchema = InvoiceBase.extend({ studentId: z.uuid({ error: "Choose a student." }) });

export async function createInvoice(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, StudentInvoiceSchema, ["/dashboard/fees"], "Invoice created.", async (i, db) => {
    const { data: year, error } = await db
      .from("student_enrollments")
      .select("academic_year_id")
      .eq("student_id", i.studentId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) return { error };
    if (!year) return { error: { message: "That student has no active enrollment, so no academic year to bill." } };

    return db.from("invoices").insert({
      student_id: i.studentId,
      academic_year_id: year.academic_year_id,
      fee_type_id: i.feeTypeId,
      amount_due: i.amount,
      due_date: i.dueDate,
      description: i.description ?? null,
    });
  });
}

const SectionInvoiceSchema = InvoiceBase.extend({ sectionId: z.uuid({ error: "Choose a section." }) });

/** One invoice per actively enrolled student of the section, in a single insert (all or nothing). */
export async function createSectionInvoices(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, SectionInvoiceSchema, ["/dashboard/fees"], "Invoices created for the section.", async (i, db) => {
    const { data: enrollments, error } = await db
      .from("student_enrollments")
      .select("student_id, academic_year_id")
      .eq("section_id", i.sectionId)
      .eq("status", "ACTIVE");
    if (error) return { error };
    if (!enrollments?.length) return { error: { message: "No students are enrolled in that section." } };

    return db.from("invoices").insert(
      enrollments.map((e) => ({
        student_id: e.student_id,
        academic_year_id: e.academic_year_id,
        fee_type_id: i.feeTypeId,
        amount_due: i.amount,
        due_date: i.dueDate,
        description: i.description ?? null,
      })),
    );
  });
}

const PaymentSchema = z.object({
  invoiceId: z.uuid({ error: "Choose an invoice." }),
  amount,
  method: z.enum(["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "ONLINE", "OTHER"]),
  status: z.enum(["PAID", "PARTIAL", "PENDING"]).default("PAID"),
  guardianId: z.string().optional().transform((v) => (v ? v : undefined)).pipe(z.uuid().optional()),
  reference: optionalText,
  notes: optionalText,
});

export async function recordPayment(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, PaymentSchema, ["/dashboard/fees"], "Payment recorded.", (i, db) =>
    db.from("payments").insert({
      invoice_id: i.invoiceId,
      amount: i.amount,
      method: i.method,
      status: i.status,
      guardian_id: i.guardianId ?? null,
      reference: i.reference ?? null,
      notes: i.notes ?? null,
    }),
  );
}

const StatusSchema = z.object({
  paymentId: z.uuid(),
  status: z.enum(["PAID", "PARTIAL", "FAILED", "REFUNDED"]),
});

/** Allowed transitions are enforced by the database (PENDING→PAID/PARTIAL/FAILED, PAID/PARTIAL→REFUNDED). */
export async function updatePaymentStatus(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, StatusSchema, ["/dashboard/fees"], "Payment updated.", (i, db) =>
    db.from("payments").update({ status: i.status }).eq("id", i.paymentId),
  );
}

export async function voidInvoice(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, z.object({ invoiceId: z.uuid() }), ["/dashboard/fees"], "Invoice voided.", (i, db) =>
    db.from("invoices").update({ voided_at: new Date().toISOString() }).eq("id", i.invoiceId),
  );
}
