import { redirect } from "next/navigation";
import { ActionForm, Checkbox } from "@/components/admin/action-form";
import { TimetableGridView } from "@/components/timetable/grid-view";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSectionLabeler } from "@/lib/school/labels";
import { createPeriod, createTimetableEntry, deleteTimetableEntry } from "@/lib/timetable/actions";
import { createClient } from "@/lib/supabase/server";

export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { section: sectionParam } = await searchParams;
  const locale = await getLocale();
  const intlLocale = locale === "bn" ? "bn-BD" : "en-GB";
  const d = getDictionary(locale);
  const t = d.timetable;
  const db = await createClient();
  const label = await getSectionLabeler(db);

  const [periodsRes, subjectsRes] = await Promise.all([
    db.from("timetable_periods").select("*").order("period_no"),
    db.from("subjects").select("id, name, name_bn").order("code"),
  ]);
  const periods = periodsRes.data ?? [];
  const subjectName = new Map(subjectsRes.data?.map((s) => [s.id, (locale === "bn" && s.name_bn) || s.name]));
  const common = { periods, locale: intlLocale, subjectName, breakLabel: t.break, periodLabel: t.period };

  // ------------------------------------------------------------------ staff
  if (profile.role === "SUPER_ADMIN" || profile.role === "ORGANIZER") {
    const [sectionsRes, teachersRes] = await Promise.all([
      db.from("sections").select("id"),
      db.from("teachers").select("id, full_name").order("full_name"),
    ]);
    const options = (sectionsRes.data ?? [])
      .map((s) => ({ id: s.id, name: label(s.id) }))
      .filter((o) => o.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    const sectionId = options.find((o) => o.id === sectionParam)?.id;
    const teacherName = new Map(teachersRes.data?.map((x) => [x.id, x.full_name]));
    const entries = sectionId
      ? ((await db.from("timetable_entries").select("*").eq("section_id", sectionId)).data ?? [])
      : [];

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>

        <Card>
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <div className="sm:col-span-2">
              <Select name="section" label={t.section} defaultValue={sectionId ?? ""} required>
                <option value="" disabled>{t.choose}</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <button className="h-11 rounded-xl bg-brand-navy px-4 text-sm font-medium text-white">{t.show}</button>
          </form>
        </Card>

        {sectionId && (
          <Card>
            <CardHeader><CardTitle>{label(sectionId)}</CardTitle></CardHeader>
            {periods.length === 0 ? (
              <p className="text-sm text-slate-500">{t.noPeriods}</p>
            ) : (
              <TimetableGridView
                {...common}
                entries={entries}
                extra={(e) => (
                  <>
                    <span className="block opacity-80">{e.teacher_id ? teacherName.get(e.teacher_id) : t.noTeacher}</span>
                    <ActionForm action={deleteTimetableEntry} submitLabel={t.remove} className="mt-1">
                      <input type="hidden" name="id" value={e.id} />
                    </ActionForm>
                  </>
                )}
              />
            )}
          </Card>
        )}

        {sectionId && periods.some((p) => !p.is_break) && (
          <Card>
            <CardHeader><CardTitle>{t.addLesson}</CardTitle></CardHeader>
            <ActionForm action={createTimetableEntry} submitLabel={t.addLesson}>
              <input type="hidden" name="sectionId" value={sectionId} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select name="weekday" label={t.day} defaultValue="0">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {new Intl.DateTimeFormat(intlLocale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + n)))}
                    </option>
                  ))}
                </Select>
                <Select name="periodId" label={t.period} required>
                  {periods.filter((p) => !p.is_break).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                <Select name="subjectId" label={t.subject} required>
                  {subjectsRes.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Select name="teacherId" label={t.teacher} defaultValue="">
                  <option value="">{t.noTeacher}</option>
                  {teachersRes.data?.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                </Select>
              </div>
              <Input name="room" label={t.room} />
              <p className="text-xs text-slate-500">{t.teacherNote}</p>
            </ActionForm>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{t.addPeriod}</CardTitle></CardHeader>
          <ActionForm action={createPeriod} submitLabel={t.addPeriod}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input name="periodNo" type="number" min={1} max={30} label={t.periodNo} required />
              <Input name="label" label={t.label} required />
              <Input name="startTime" type="time" label={t.start} required />
              <Input name="endTime" type="time" label={t.end} required />
            </div>
            <Checkbox name="isBreak" label={t.isBreak} />
          </ActionForm>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------- teacher
  if (profile.role === "TEACHER") {
    const { data: me } = await db.from("teachers").select("id").eq("profile_id", profile.id).maybeSingle();
    const entries = me ? ((await db.from("timetable_entries").select("*").eq("teacher_id", me.id)).data ?? []) : [];
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
        <Card>
          <CardHeader><CardTitle>{t.mine}</CardTitle></CardHeader>
          {periods.length === 0 || entries.length === 0 ? (
            <p className="text-sm text-slate-500">{periods.length === 0 ? t.noPeriods : t.noTimetable}</p>
          ) : (
            <TimetableGridView {...common} entries={entries} extra={(e) => <span className="block opacity-80">{label(e.section_id)}</span>} />
          )}
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------ student / guardian
  const [students, enrollments, entriesRes] = await Promise.all([
    db.from("students").select("id, full_name").order("full_name"),
    db.from("student_enrollments").select("student_id, section_id").eq("status", "ACTIVE"),
    db.from("timetable_entries").select("*"),
  ]);
  const sectionOf = new Map(enrollments.data?.map((e) => [e.student_id, e.section_id]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
      {!students.data?.length ? (
        <Card><p className="text-sm text-slate-500">{d.attendance.noChildren}</p></Card>
      ) : (
        students.data.map((student) => {
          const sectionId = sectionOf.get(student.id);
          const entries = (entriesRes.data ?? []).filter((e) => e.section_id === sectionId);
          return (
            <Card key={student.id}>
              <CardHeader>
                <CardTitle>{student.full_name}{sectionId ? ` · ${label(sectionId)}` : ""}</CardTitle>
              </CardHeader>
              {periods.length === 0 || entries.length === 0 ? (
                <p className="text-sm text-slate-500">{periods.length === 0 ? t.noPeriods : t.noTimetable}</p>
              ) : (
                <TimetableGridView {...common} entries={entries} />
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
