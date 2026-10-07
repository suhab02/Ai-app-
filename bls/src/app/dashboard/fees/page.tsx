import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCurrentProfile } from "@/lib/auth/dal";
import {
  createFeeType,
  createInvoice,
  createSectionInvoices,
  recordPayment,
  updatePaymentStatus,
  voidInvoice,
} from "@/lib/fees/actions";
import { formatMoney, summarizeInvoice, type InvoiceState } from "@/lib/fees/money";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { schoolToday } from "@/lib/school/date";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/supabase/types";

const METHODS: PaymentMethod[] = ["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "ONLINE", "OTHER"];
const STATE_TONE: Record<InvoiceState, "green" | "orange" | "red" | "slate" | "navy"> = {
  PAID: "green", PARTIAL: "orange", UNPAID: "navy", OVERDUE: "red", VOID: "slate",
};

export default async function FeesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const locale = await getLocale();
  const d = getDictionary(locale);
  const t = d.fees;
  const db = await createClient();
  const today = schoolToday();
  const money = (n: number) => formatMoney(n, locale);

  // Under RLS: staff get everything; a student their own; a guardian their children's.
  const [feeTypes, invoices, payments, students] = await Promise.all([
    db.from("fee_types").select("*").order("code"),
    db.from("invoices").select("*").order("created_at", { ascending: false }).limit(300),
    db.from("payments").select("*").order("created_at", { ascending: false }).limit(600),
    db.from("students").select("id, full_name, admission_number").order("full_name"),
  ]);
  const feeName = new Map(feeTypes.data?.map((f) => [f.id, (locale === "bn" && f.name_bn) || f.name]));
  const studentName = new Map(students.data?.map((s) => [s.id, s.full_name]));
  const paymentsByInvoice = new Map<string, NonNullable<typeof payments.data>>();
  for (const p of payments.data ?? []) paymentsByInvoice.set(p.invoice_id, [...(paymentsByInvoice.get(p.invoice_id) ?? []), p]);
  const summaries = new Map((invoices.data ?? []).map((i) => [i.id, summarizeInvoice(i, paymentsByInvoice.get(i.id) ?? [], today)]));

  const isStaff = profile.role === "SUPER_ADMIN" || profile.role === "ORGANIZER";

  const invoiceList = (list: NonNullable<typeof invoices.data>) =>
    list.map((inv) => {
      const sum = summaries.get(inv.id)!;
      const own = paymentsByInvoice.get(inv.id) ?? [];
      return (
        <Card key={inv.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-brand-navy">
                {feeName.get(inv.fee_type_id)}{inv.description ? ` · ${inv.description}` : ""}
              </p>
              <p className="text-xs text-slate-500">{studentName.get(inv.student_id)} · {t.dueDate} {inv.due_date}</p>
            </div>
            <Badge tone={STATE_TONE[sum.state]}>{d.enums.invoiceState[sum.state]}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] text-slate-500">{t.due}</dt><dd className="font-semibold text-brand-navy">{money(inv.amount_due)}</dd></div>
            <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] text-slate-500">{t.paid}</dt><dd className="font-semibold text-brand-green-dark">{money(sum.paid)}</dd></div>
            <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] text-slate-500">{t.balance}</dt><dd className="font-semibold text-brand-navy">{money(sum.balance)}</dd></div>
          </dl>
          {own.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-sm">
              {own.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-600">
                    <span className="font-mono text-xs text-slate-400">{p.receipt_no}</span> · {money(p.amount)} · {d.enums.paymentMethod[p.method]} · {d.enums.paymentStatus[p.status]}
                  </span>
                  <span className="flex items-center gap-3">
                    {(p.status === "PAID" || p.status === "PARTIAL") && (
                      <Link href={`/dashboard/fees/receipt/${p.id}`} className="text-sm font-medium text-brand-green hover:underline">{t.viewReceipt} →</Link>
                    )}
                    {isStaff && (p.status === "PAID" || p.status === "PARTIAL") && (
                      <ActionForm action={updatePaymentStatus} submitLabel={t.refund} compact>
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="status" value="REFUNDED" />
                      </ActionForm>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {isStaff && own.every((p) => p.status !== "PAID" && p.status !== "PARTIAL") && !inv.voided_at && (
            <ActionForm action={voidInvoice} submitLabel={t.void} className="mt-3">
              <input type="hidden" name="invoiceId" value={inv.id} />
            </ActionForm>
          )}
        </Card>
      );
    });

  // ---------------------------------------------------------------- staff
  if (isStaff) {
    const [sections, guardians] = await Promise.all([db.from("sections").select("id"), db.from("guardians").select("id, full_name").order("full_name")]);
    const label = await getSectionLabeler(db);
    const sectionOptions = (sections.data ?? []).map((s) => ({ id: s.id, name: label(s.id) })).filter((o) => o.name).sort((a, b) => a.name.localeCompare(b.name));
    const open = (invoices.data ?? []).filter((i) => (summaries.get(i.id)?.balance ?? 0) > 0 && !i.voided_at);
    const feeOptions = feeTypes.data?.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>);

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
        <p className="text-xs text-slate-500">{t.ledgerNote}</p>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>{t.feeTypes}</CardTitle></CardHeader>
            <ul className="mb-3 text-sm text-slate-600">
              {feeTypes.data?.map((f) => <li key={f.id}><span className="font-mono text-slate-400">{f.code}</span> {f.name}</li>)}
            </ul>
            <ActionForm action={createFeeType} submitLabel={t.create}>
              <div className="grid grid-cols-3 gap-3">
                <Input name="code" label={t.code} required />
                <Input name="name" label={t.name} required />
                <Input name="nameBn" label={t.nameBn} />
              </div>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t.newInvoice} · {t.forStudent}</CardTitle></CardHeader>
            <ActionForm action={createInvoice} submitLabel={t.createInvoices}>
              <Select name="studentId" label={t.student} required defaultValue="">
                <option value="" disabled>{t.choose}</option>
                {students.data?.map((s) => <option key={s.id} value={s.id}>{s.admission_number} · {s.full_name}</option>)}
              </Select>
              <Select name="feeTypeId" label={t.feeType} required defaultValue="">
                <option value="" disabled>{t.choose}</option>
                {feeOptions}
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input name="amount" type="number" step="0.01" min="0.01" label={t.amount} required />
                <Input name="dueDate" type="date" label={t.dueDate} required />
              </div>
              <Input name="description" label={t.description} />
            </ActionForm>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t.newInvoice} · {t.forSection}</CardTitle></CardHeader>
            <ActionForm action={createSectionInvoices} submitLabel={t.createInvoices}>
              <Select name="sectionId" label={t.section} required defaultValue="">
                <option value="" disabled>{t.choose}</option>
                {sectionOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <Select name="feeTypeId" label={t.feeType} required defaultValue="">
                <option value="" disabled>{t.choose}</option>
                {feeOptions}
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input name="amount" type="number" step="0.01" min="0.01" label={t.amount} required />
                <Input name="dueDate" type="date" label={t.dueDate} required />
              </div>
              <Input name="description" label={t.description} />
            </ActionForm>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>{t.recordPayment}</CardTitle></CardHeader>
          <ActionForm action={recordPayment} submitLabel={t.save}>
            <Select name="invoiceId" label={t.invoice} required defaultValue="">
              <option value="" disabled>{t.choose}</option>
              {open.map((i) => (
                <option key={i.id} value={i.id}>
                  {studentName.get(i.student_id)} · {feeName.get(i.fee_type_id)} · {money(summaries.get(i.id)!.balance)} {t.outstanding}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input name="amount" type="number" step="0.01" min="0.01" label={t.amount} required />
              <Select name="method" label={t.method} defaultValue="CASH">
                {METHODS.map((m) => <option key={m} value={m}>{d.enums.paymentMethod[m]}</option>)}
              </Select>
              <Select name="status" label={t.status} defaultValue="PAID">
                {(["PAID", "PARTIAL", "PENDING"] as const).map((s) => <option key={s} value={s}>{d.enums.paymentStatus[s]}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select name="guardianId" label={t.guardian} defaultValue="">
                <option value="">{t.anyone}</option>
                {guardians.data?.map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
              </Select>
              <Input name="reference" label={t.reference} />
            </div>
            <Input name="notes" label={t.notes} />
          </ActionForm>
        </Card>

        <h2 className="text-lg font-semibold text-brand-navy">{t.invoices}</h2>
        {invoices.data?.length ? <div className="flex flex-col gap-3">{invoiceList(invoices.data)}</div> : <Card><p className="text-sm text-slate-500">{t.noInvoices}</p></Card>}
      </div>
    );
  }

  // ------------------------------------------------- teacher: no fee access
  if (profile.role === "TEACHER") redirect("/dashboard");

  // ---------------------------------------------------- student / guardian
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
      {invoices.data?.length ? <div className="flex flex-col gap-3">{invoiceList(invoices.data)}</div> : <Card><p className="text-sm text-slate-500">{t.noInvoices}</p></Card>}
    </div>
  );
}
