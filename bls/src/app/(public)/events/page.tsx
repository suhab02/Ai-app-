import { Card } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { nowMs } from "@/lib/school/date";
import { createClient } from "@/lib/supabase/server";

export default async function PublicEventsPage() {
  const locale = await getLocale();
  const t = getDictionary(locale).public;
  const db = await createClient();
  const fmt = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const day = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeZone: "Asia/Dhaka" });

  const [notices, events] = await Promise.all([
    db.from("notices").select("id, title, body, published_at").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(20),
    db.from("events").select("id, title, description, starts_at, ends_at, location").gte("starts_at", new Date(nowMs() - 86_400_000).toISOString()).order("starts_at").limit(20),
  ]);

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-brand-navy">{t.latestNews}</h1>
        {!notices.data?.length ? <p className="text-sm text-slate-500">{t.noNews}</p> : notices.data.map((n) => (
          <Card key={n.id}>
            <p className="font-semibold text-brand-navy">{n.title}</p>
            {n.published_at && <p className="text-xs text-slate-500">{day.format(new Date(n.published_at))}</p>}
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold text-brand-navy">{t.upcomingEvents}</h2>
        {!events.data?.length ? <p className="text-sm text-slate-500">{t.noEvents}</p> : events.data.map((e) => (
          <Card key={e.id}>
            <p className="font-semibold text-brand-navy">{e.title}</p>
            <p className="text-xs text-slate-500">{fmt.format(new Date(e.starts_at))}{e.ends_at ? ` → ${fmt.format(new Date(e.ends_at))}` : ""}{e.location ? ` · ${e.location}` : ""}</p>
            {e.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{e.description}</p>}
          </Card>
        ))}
      </section>
    </div>
  );
}
