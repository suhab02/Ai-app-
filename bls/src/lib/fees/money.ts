import type { PaymentStatus } from "@/lib/supabase/types";

/**
 * Money arithmetic is done in integer paisa (1 taka = 100 paisa) so sums never pick up
 * floating-point error. The database stores numeric(12,2) and returns plain JSON numbers.
 */
export const toPaisa = (amount: number): number => Math.round(amount * 100);
export const fromPaisa = (paisa: number): number => paisa / 100;

/** True when the value has at most two decimal places (i.e. is a valid amount of money). */
export const hasValidPrecision = (amount: number): boolean => Number.isFinite(amount) && toPaisa(amount) / 100 === amount;

/** "৳ 2,000" (English) or "৳ ২,০০০" (Bangla digits). Decimals only when there are paisa. */
export function formatMoney(amount: number, locale: "en" | "bn" = "en"): string {
  const hasPaisa = toPaisa(amount) % 100 !== 0;
  const formatted = new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-US", {
    minimumFractionDigits: hasPaisa ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `৳ ${formatted}`;
}

/** Only PAID and PARTIAL payments count toward an invoice (mirrors invoice_paid_total() in the database). */
export const COUNTED_STATUSES: readonly PaymentStatus[] = ["PAID", "PARTIAL"];

export type InvoiceState = "VOID" | "PAID" | "PARTIAL" | "OVERDUE" | "UNPAID";

export interface InvoiceSummary {
  paid: number;
  balance: number;
  state: InvoiceState;
}

export function summarizeInvoice(
  invoice: { amount_due: number; due_date: string; voided_at: string | null },
  payments: readonly { amount: number; status: PaymentStatus }[],
  today: string,
): InvoiceSummary {
  const paidPaisa = payments.filter((p) => COUNTED_STATUSES.includes(p.status)).reduce((n, p) => n + toPaisa(p.amount), 0);
  const duePaisa = toPaisa(invoice.amount_due);
  const balancePaisa = Math.max(duePaisa - paidPaisa, 0);

  let state: InvoiceState;
  if (invoice.voided_at) state = "VOID";
  else if (balancePaisa === 0) state = "PAID";
  else if (invoice.due_date < today) state = "OVERDUE";
  else if (paidPaisa > 0) state = "PARTIAL";
  else state = "UNPAID";

  return { paid: fromPaisa(paidPaisa), balance: fromPaisa(balancePaisa), state };
}
