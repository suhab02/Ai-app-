import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizeAttendance } from "@/lib/attendance/summary";
import type { getDictionary } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { schoolToday } from "@/lib/school/date";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";
import { AttendanceCalendar } from "./calendar";
import { STATUS_BADGE } from "./status-style";

const isMonth = (v: string | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Student / guardian view. `students` and `attendance_records` are read under
 * the caller's RLS: a student gets themself, a guardian only their linked
 * children, so nothing here filters by "who am I" in application code.
 */
export async function FamilyAttendance({
  dictionary,
  locale,
  monthParam,
}: {
  dictionary: ReturnType<typeof getDictionary>;
  locale: Locale;
  monthParam?: string;
}) {
  const t = dictionary.attendance;
  const db = await createClient();
  const intlLocale = locale === "bn" ? "bn-BD" : "en-GB";
  const month = isMonth(monthParam) ? monthParam : schoolToday().slice(0, 7);

  const [students, records] = await Promise.all([
    db.from("students").select("id, full_name").order("full_name"),
    db.from("attendance_records").select("student_id, attendance_date, status").order("attendance_date", { ascending: false }),
  ]);

  const monthTitle = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
  const percent = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 });

  if (!students.data?.length) {
    return <Card><p className="text-sm text-slate-500">{t.noChildren}</p></Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
      <p className="text-xs text-slate-500">{t.rule}</p>

      {students.data.map((student) => {
        const own = records.data?.filter((r) => r.student_id === student.id) ?? [];
        const summary = summarizeAttendance(own.map((r) => r.status));
        const statusByDate = new Map<string, AttendanceStatus>(
          own.filter((r) => r.attendance_date.startsWith(month)).map((r) => [r.attendance_date, r.status]),
        );
        const stats: [string, string][] = [
          [t.totalDays, String(summary.totalDays)],
          [t.present, String(summary.present)],
          [t.absent, String(summary.absent)],
          [t.late, String(summary.late)],
          [t.excused, String(summary.excused)],
          [t.leave, String(summary.leave)],
        ];

        return (
          <Card key={student.id}>
            <CardHeader>
              <CardTitle>{student.full_name}</CardTitle>
              <Badge tone={summary.percentage !== null && summary.percentage < 75 ? "orange" : "green"}>
                {t.percentage}: {summary.percentage === null ? "—" : `${percent.format(summary.percentage)}%`}
              </Badge>
            </CardHeader>

            {own.length === 0 ? (
              <p className="text-sm text-slate-500">{t.noData}</p>
            ) : (
              <div className="flex flex-col gap-5">
                <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {stats.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3 text-center">
                      <dt className="text-[11px] text-slate-500">{label}</dt>
                      <dd className="text-lg font-semibold text-brand-navy">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-brand-navy">{t.calendar} · {monthTitle}</h4>
                    <div className="flex gap-2 text-xs">
                      <Link className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50" href={`?month=${shiftMonth(month, -1)}`}>{t.prev}</Link>
                      <Link className="rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50" href={`?month=${shiftMonth(month, 1)}`}>{t.next}</Link>
                    </div>
                  </div>
                  <AttendanceCalendar month={month} statusByDate={statusByDate} locale={intlLocale} statusLabels={t.statuses} />
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-brand-navy">{t.history}</h4>
                  <ul className="flex flex-col divide-y divide-slate-100 text-sm">
                    {own.slice(0, 30).map((r) => (
                      <li key={r.attendance_date} className="flex items-center justify-between py-2">
                        <span className="text-slate-600">{r.attendance_date}</span>
                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_BADGE[r.status])}>{t.statuses[r.status]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
