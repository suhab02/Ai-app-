import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { nowMs } from "@/lib/school/date";
import { getSiteContent, pick } from "@/lib/site/content";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const locale = await getLocale();
  const t = getDictionary(locale).public;
  const db = await createClient();
  const dateFmt = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeZone: "Asia/Dhaka" });

  // Everything here is read as the anonymous role: RLS returns only published, public rows.
  const [content, notices, events, photos] = await Promise.all([
    getSiteContent(db),
    db.from("notices").select("id, title, body, published_at").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(3),
    db.from("events").select("id, title, starts_at, location").gte("starts_at", new Date(nowMs() - 86_400_000).toISOString()).order("starts_at").limit(3),
    db.from("gallery_photos").select("id, storage_path, caption").order("created_at", { ascending: false }).limit(6),
  ]);
  const hero = content.get("home_hero");
  const urlFor = (path: string) => db.storage.from("gallery-public").getPublicUrl(path).data.publicUrl;

  return (
    <>
      <section className="rounded-3xl bg-brand-navy px-6 py-12 text-white sm:px-10">
        <h1 className="text-3xl font-bold sm:text-4xl">{pick(locale, hero?.title_en ?? "", hero?.title_bn ?? "")}</h1>
        <p className="mt-3 max-w-prose text-lg text-white/85">{pick(locale, hero?.body_en ?? "", hero?.body_bn ?? "")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/admissions" className="rounded-xl bg-brand-orange px-5 py-3 text-sm font-semibold text-white hover:bg-brand-orange-dark">{t.applyNow}</Link>
          <Link href="/about" className="rounded-xl border border-white/40 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">{t.nav.about}</Link>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-brand-navy">{t.latestNews}</h2>
          {!notices.data?.length ? <p className="text-sm text-slate-500">{t.noNews}</p> : notices.data.map((n) => (
            <Card key={n.id}>
              <p className="font-semibold text-brand-navy">{n.title}</p>
              {n.published_at && <p className="text-xs text-slate-500">{dateFmt.format(new Date(n.published_at))}</p>}
              <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
            </Card>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-brand-navy">{t.upcomingEvents}</h2>
          {!events.data?.length ? <p className="text-sm text-slate-500">{t.noEvents}</p> : events.data.map((e) => (
            <Card key={e.id}>
              <p className="font-semibold text-brand-navy">{e.title}</p>
              <p className="text-xs text-slate-500">{dateFmt.format(new Date(e.starts_at))}{e.location ? ` · ${e.location}` : ""}</p>
            </Card>
          ))}
          <Link href="/events" className="text-sm font-medium text-brand-green hover:underline">{t.readMore} →</Link>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-brand-navy">{t.photos}</h2>
        {!photos.data?.length ? <p className="text-sm text-slate-500">{t.noPhotos}</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.data.map((p) => (
              <li key={p.id}>
                <Image src={urlFor(p.storage_path)} alt={p.caption ?? ""} width={320} height={240} unoptimized className="h-36 w-full rounded-2xl object-cover" />
              </li>
            ))}
          </ul>
        )}
        <Link href="/gallery" className="text-sm font-medium text-brand-green hover:underline">{t.readMore} →</Link>
      </section>
    </>
  );
}
