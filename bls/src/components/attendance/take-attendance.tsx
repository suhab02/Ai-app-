import { ActionForm } from "@/components/admin/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { saveAttendance } from "@/lib/attendance/actions";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getSectionLabeler } from "@/lib/school/labels";
import { isIsoDate, schoolToday } from "@/lib/school/date";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceStatus, ProfileRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";
import { ATTENDANCE_STATUSES, STATUS_CHECKED } from "./status-style";

/**
 * Roster for staff and teachers. Every read runs under the caller's RLS, so a
 * teacher only ever gets their own sections' enrollments and attendance even if
 * they hand-edit the `section` query parameter.
 */
export async function TakeAttendance({
  profile,
  dictionary,
  sectionParam,
  dateParam,
}: {
  profile: ProfileRow;
  dictionary: ReturnType<typeof getDictionary>;
  sectionParam?: string;
  dateParam?: string;
}) {
  const t = dictionary.attendance;
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const today = schoolToday();
  const date = isIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  let sectionIds: string[];
  if (profile.role === "TEACHER") {
    const { data } = await db.from("teacher_assignments").select("section_id");
    sectionIds = [...new Set(data?.map((a) => a.section_id))];
  } else {
    const { data } = await db.from("sections").select("id");
    sectionIds = data?.map((s) => s.id) ?? [];
  }
  const options = sectionIds
    .map((id) => ({ id, name: label(id) }))
    .filter((o) => o.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const sectionId = options.find((o) => o.id === sectionParam)?.id;

  let roster: { id: string; name: string; roll: string | null; status: AttendanceStatus | undefined }[] = [];
  let alreadyMarked = false;
  if (sectionId) {
    const { data: enrollments } = await db
      .from("student_enrollments")
      .select("student_id, roll_number")
      .eq("section_id", sectionId)
      .eq("status", "ACTIVE");
    const studentIds = enrollments?.map((e) => e.student_id) ?? [];
    const [students, records] = studentIds.length
      ? await Promise.all([
          db.from("students").select("id, full_name").in("id", studentIds),
          db.from("attendance_records").select("student_id, status").eq("attendance_date", date).in("student_id", studentIds),
        ])
      : [{ data: [] }, { data: [] }];
    const nameById = new Map(students.data?.map((s) => [s.id, s.full_name]));
    const statusById = new Map(records.data?.map((r) => [r.student_id, r.status]));
    alreadyMarked = (records.data?.length ?? 0) > 0;
    roster = (enrollments ?? [])
      .map((e) => ({
        id: e.student_id,
        name: nameById.get(e.student_id) ?? "",
        roll: e.roll_number,
        status: statusById.get(e.student_id),
      }))
      .sort((a, b) => Number(a.roll ?? 1e9) - Number(b.roll ?? 1e9) || a.name.localeCompare(b.name));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.take}</h1>

      {options.length === 0 ? (
        <Card><p className="text-sm text-slate-500">{t.noSections}</p></Card>
      ) : (
        <Card>
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <Select name="section" label={t.section} defaultValue={sectionId ?? ""} required>
              <option value="" disabled>{dictionary.admin.relationships.choose}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="date" className="text-sm font-medium text-brand-navy">{t.date}</label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={date}
                max={today}
                className="h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-brand-navy"
              />
            </div>
            <button className="h-11 rounded-xl bg-brand-navy px-4 text-sm font-medium text-white">{t.load}</button>
          </form>
        </Card>
      )}

      {sectionId && (
        <Card>
          <CardHeader><CardTitle>{label(sectionId)} · {date}</CardTitle></CardHeader>
          {roster.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noStudents}</p>
          ) : (
            <>
              {alreadyMarked && <p className="mb-3 rounded-xl bg-brand-orange-light px-3 py-2 text-xs text-brand-orange-dark">{t.alreadyMarked}</p>}
              <ActionForm action={saveAttendance} submitLabel={t.save}>
                <input type="hidden" name="sectionId" value={sectionId} />
                <input type="hidden" name="date" value={date} />
                <ul className="flex flex-col divide-y divide-slate-100">
                  {roster.map((s) => (
                    <li key={s.id} className="flex flex-col gap-2 py-3">
                      <p className="text-sm font-medium text-brand-navy">
                        {s.roll && <span className="mr-2 font-mono text-slate-400">{s.roll}</span>}
                        {s.name}
                      </p>
                      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={s.name}>
                        {ATTENDANCE_STATUSES.map((status) => (
                          <label key={status} className="cursor-pointer">
                            <input
                              type="radio"
                              name={`status:${s.id}`}
                              value={status}
                              defaultChecked={(s.status ?? "PRESENT") === status}
                              className="peer sr-only"
                            />
                            <span
                              className={cn(
                                "flex h-11 items-center justify-center rounded-xl border border-slate-300 px-1 text-[11px] font-medium text-slate-600 transition-colors",
                                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-green peer-focus-visible:ring-offset-1",
                                STATUS_CHECKED[status],
                              )}
                            >
                              {t.statuses[status]}
                            </span>
                          </label>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </ActionForm>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
