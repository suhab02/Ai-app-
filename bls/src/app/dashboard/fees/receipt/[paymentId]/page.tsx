import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getCurrentProfile } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/fees/money";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const en = getDictionary("en");
const bn = getDictionary("bn");

/** One label in both languages, as on the paper receipt: "Receipt No / রিসিপ্ট নং". */
function Bi({ k }: { k: keyof typeof en.fees.receiptDoc }) {
  return (
    <>
      <span className="block text-[11px] uppercase tracking-wide text-slate-500">{en.fees.receiptDoc[k]}</span>
      <span className="block text-xs text-slate-400">{bn.fees.receiptDoc[k]}</span>
    </>
  );
}

/**
 * Receipt for one payment. Loaded under the caller's RLS: staff, the paying student, or a linked
 * guardian — anyone else gets a 404, indistinguishable from a payment that doesn't exist.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { paymentId } = await params;
  if (!z.uuid().safeParse(paymentId).success) notFound();

  const locale = await getLocale();
  const t = getDictionary(locale).fees;
  const db = await createClient();

  const { data: payment } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) notFound();

  const [invoice, student] = await Promise.all([
    db.from("invoices").select("fee_type_id, description").eq("id", payment.invoice_id).maybeSingle(),
    db.from("students").select("full_name, full_name_bn, admission_number").eq("id", payment.student_id).maybeSingle(),
  ]);
  const feeType = invoice.data ? (await db.from("fee_types").select("name, name_bn").eq("id", invoice.data.fee_type_id).maybeSingle()).data : null;

  const completed = payment.status === "PAID" || payment.status === "PARTIAL";
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(payment.paid_at));
  const method = `${en.enums.paymentMethod[payment.method]} / ${bn.enums.paymentMethod[payment.method]}`;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/fees" className="text-sm text-brand-green hover:underline">← {t.receiptDoc.back}</Link>
        {completed && <PrintButton label={t.receiptDoc.print} />}
      </div>

      {!completed ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          {payment.status === "REFUNDED" ? t.receiptDoc.refunded : t.receiptDoc.notValid}
        </p>
      ) : (
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:border-slate-400 print:shadow-none">
          <header className="bg-brand-navy px-6 py-5 text-center text-white">
            <p className="text-lg font-bold">{en.common.appName}</p>
            <p className="text-sm opacity-90">{bn.common.appName}</p>
          </header>

          <div className="px-6 py-6">
            <div className="text-center">
              <p className="text-sm font-semibold tracking-widest text-brand-navy">{en.fees.receiptDoc.title}</p>
              <p className="text-xs text-slate-500">{bn.fees.receiptDoc.title}</p>
            </div>

            <div className="my-6 rounded-2xl bg-brand-green-light py-5 text-center">
              <p className="text-4xl font-bold text-brand-green-dark">{formatMoney(payment.amount, "en")}</p>
              <p className="mt-1 text-xs text-brand-green-dark/80"><Bi k="amountPaid" /></p>
            </div>

            <dl className="flex flex-col divide-y divide-slate-100 text-sm">
              <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="receiptNo" /></dt><dd className="font-mono font-semibold text-brand-navy">{payment.receipt_no}</dd></div>
              <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="feeType" /></dt><dd className="text-right font-medium text-brand-navy">{feeType?.name}{feeType?.name_bn ? ` / ${feeType.name_bn}` : ""}</dd></div>
              <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="studentName" /></dt><dd className="text-right font-medium text-brand-navy">{student.data?.full_name}{student.data?.full_name_bn ? ` / ${student.data.full_name_bn}` : ""}<span className="block font-mono text-xs text-slate-400">{student.data?.admission_number}</span></dd></div>
              <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="dateTime" /></dt><dd className="text-right font-medium text-brand-navy">{when}</dd></div>
              <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="method" /></dt><dd className="text-right font-medium text-brand-navy">{method}</dd></div>
              {payment.reference && <div className="flex items-start justify-between gap-4 py-3"><dt><Bi k="reference" /></dt><dd className="text-right font-mono text-brand-navy">{payment.reference}</dd></div>}
            </dl>

            <div className="mt-6 rounded-xl border border-brand-green/30 bg-brand-green-light px-4 py-3 text-center">
              <p className="text-sm font-semibold text-brand-green-dark">✓ {en.fees.receiptDoc.success}</p>
              <p className="text-xs text-brand-green-dark/80">{bn.fees.receiptDoc.success}</p>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
