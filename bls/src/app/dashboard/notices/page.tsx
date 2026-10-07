import { redirect } from "next/navigation";
import { ActionForm, Checkbox } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import {
  createEvent,
  createNotice,
  deleteEvent,
  deleteNotice,
  setEventPublished,
  setNoticePublished,
} from "@/lib/notices/actions";
import { nowMs } from "@/lib/school/date";
import { getSectionLabeler } from "@/lib/school/labels";
import { createClient } from "@/lib/supabase/server";
import type { NoticeAudience } from "@/lib/supabase/types";

const AUDIENCES: NoticeAudience[] = ["ALL", "TEACHERS", "STUDENTS", "PARENTS"];

export default async function NoticesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const locale = await getLocale();
  const intlLocale = locale === "bn" ? "bn-BD" : "en-GB";
  const d = getDictionary(locale);
  const t = d.notices;
  const db = await createClient();
  const label = await getSectionLabeler(db);
  const isStaff = profile.role === "SUPER_ADMIN" || profile.role === "ORGANIZER";
  const now = nowMs();

  // Under RLS: staff see everything; everyone else only what is published, current and addressed to them.
  const [notices, events, sections] = await Promise.all([
    db.from("notices").select("*").order("is_pinned", { ascending: false }).order("published_at", { ascending: false, nullsFirst: true }).limit(100),
    db.from("events").select("*").order("starts_at", { ascending: true }).limit(100),
    isStaff ? db.from("sections").select("id") : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const fmt = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const day = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "Asia/Dhaka" });
  const upcoming = (events.data ?? []).filter((e) => isStaff || new Date(e.ends_at ?? e.starts_at).getTime() >= now - 86_400_000);
  const sectionOptions = (sections.data ?? []).map((s) => ({ id: s.id, name: label(s.id) })).filter((o) => o.name).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>

      {isStaff && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t.newNotice}</CardTitle></CardHeader>
            <ActionForm action={createNotice} submitLabel={t.save}>
              <Input name="title" label={t.noticeTitle} maxLength={200} required />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="body" className="text-sm font-medium text-brand-navy">{t.body}</label>
                <textarea id="body" name="body" rows={4} maxLength={5000} required className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select name="audience" label={t.audience} defaultValue="ALL">
                  {AUDIENCES.map((a) => <option key={a} value={a}>{d.enums.audience[a]}</option>)}
                </Select>
                <Select name="sectionId" label={t.target} defaultValue="">
                  <option value="">{t.everyone}</option>
                  {sectionOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
              <Input name="expiresOn" type="date" label={t.expires} />
              <Checkbox name="isPublished" label={t.publishNow} defaultChecked />
              <Checkbox name="isPinned" label={t.pinned} />
              <Checkbox name="isPublic" label={t.public} />
              <p className="text-xs text-slate-500">{t.publicNote}</p>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t.newEvent}</CardTitle></CardHeader>
            <ActionForm action={createEvent} submitLabel={t.save}>
              <Input name="title" label={t.noticeTitle} maxLength={200} required />
              <Input name="description" label={t.description} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input name="startsAt" type="datetime-local" label={t.starts} required />
                <Input name="endsAt" type="datetime-local" label={t.ends} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input name="location" label={t.location} />
                <Select name="audience" label={t.audience} defaultValue="ALL">
                  {AUDIENCES.map((a) => <option key={a} value={a}>{d.enums.audience[a]}</option>)}
                </Select>
              </div>
              <Checkbox name="isPublished" label={t.publishNow} defaultChecked />
              <Checkbox name="isPublic" label={t.public} />
            </ActionForm>
          </Card>
        </div>
      )}

      <h2 className="text-lg font-semibold text-brand-navy">{t.notices}</h2>
      {!notices.data?.length ? (
        <Card><p className="text-sm text-slate-500">{t.noNotices}</p></Card>
      ) : (
        notices.data.map((n) => {
          const scheduled = n.is_published && n.published_at && new Date(n.published_at).getTime() > now;
          const expired = n.expires_at && new Date(n.expires_at).getTime() <= now;
          return (
            <Card key={n.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-navy">{n.is_pinned && "📌 "}{n.title}</p>
                  <p className="text-xs text-slate-500">
                    {n.published_at ? day.format(new Date(n.published_at)) : t.draft}
                    {n.section_id ? ` · ${label(n.section_id)}` : ""} · {d.enums.audience[n.audience]}
                  </p>
                </div>
                {isStaff && (
                  <div className="flex gap-2">
                    {!n.is_published && <Badge tone="orange">{t.draft}</Badge>}
                    {scheduled && <Badge tone="navy">{t.scheduled}</Badge>}
                    {expired && <Badge tone="slate">{t.expired}</Badge>}
                    {n.is_public && <Badge tone="green">{t.public}</Badge>}
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
              {isStaff && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionForm action={setNoticePublished} submitLabel={n.is_published ? t.unpublish : t.publish} compact>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="publish" value={n.is_published ? "false" : "true"} />
                  </ActionForm>
                  <ActionForm action={deleteNotice} submitLabel={t.delete} compact>
                    <input type="hidden" name="id" value={n.id} />
                  </ActionForm>
                </div>
              )}
            </Card>
          );
        })
      )}

      <h2 className="text-lg font-semibold text-brand-navy">{t.events}</h2>
      {!upcoming.length ? (
        <Card><p className="text-sm text-slate-500">{t.noEvents}</p></Card>
      ) : (
        upcoming.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-brand-navy">{e.title}</p>
                <p className="text-xs text-slate-500">
                  {fmt.format(new Date(e.starts_at))}{e.ends_at ? ` → ${fmt.format(new Date(e.ends_at))}` : ""}
                  {e.location ? ` · ${e.location}` : ""} · {d.enums.audience[e.audience]}
                </p>
              </div>
              {isStaff && (
                <div className="flex gap-2">
                  {!e.is_published && <Badge tone="orange">{t.draft}</Badge>}
                  {e.is_public && <Badge tone="green">{t.public}</Badge>}
                </div>
              )}
            </div>
            {e.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{e.description}</p>}
            {isStaff && (
              <div className="mt-3 flex flex-wrap gap-3">
                <ActionForm action={setEventPublished} submitLabel={e.is_published ? t.unpublish : t.publish} compact>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="publish" value={e.is_published ? "false" : "true"} />
                </ActionForm>
                <ActionForm action={deleteEvent} submitLabel={t.delete} compact>
                  <input type="hidden" name="id" value={e.id} />
                </ActionForm>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
