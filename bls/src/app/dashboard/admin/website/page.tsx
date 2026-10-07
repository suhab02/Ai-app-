import { ActionForm } from "@/components/admin/action-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireStaff } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { saveSiteContent } from "@/lib/site/actions";
import { getSiteContent } from "@/lib/site/content";
import { createClient } from "@/lib/supabase/server";

function Textarea({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-brand-navy">{label}</label>
      <textarea name={name} rows={5} maxLength={10000} defaultValue={defaultValue} className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm" />
    </div>
  );
}

export default async function WebsiteAdminPage() {
  await requireStaff();
  const d = getDictionary(await getLocale());
  const t = d.website;
  const blocks = [...(await getSiteContent(await createClient())).values()].sort((a, b) => a.key.localeCompare(b.key));
  const labels = t.labels as Record<string, string>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>
      <p className="text-sm text-slate-600">{t.help}</p>

      {blocks.map((b) => (
        <Card key={b.key}>
          <CardHeader><CardTitle>{labels[b.key] ?? b.key} <span className="font-mono text-xs font-normal text-slate-400">{b.key}</span></CardTitle></CardHeader>
          <ActionForm action={saveSiteContent} submitLabel={t.save}>
            <input type="hidden" name="key" value={b.key} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Input name="titleEn" label={t.titleEn} defaultValue={b.title_en} maxLength={200} />
                <Textarea name="bodyEn" label={t.bodyEn} defaultValue={b.body_en} />
              </div>
              <div className="flex flex-col gap-3">
                <Input name="titleBn" label={t.titleBn} defaultValue={b.title_bn} maxLength={200} />
                <Textarea name="bodyBn" label={t.bodyBn} defaultValue={b.body_bn} />
              </div>
            </div>
          </ActionForm>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle>{t.newBlock}</CardTitle></CardHeader>
        <ActionForm action={saveSiteContent} submitLabel={t.save}>
          <Input name="key" label={t.key} placeholder="principal_message" pattern="[a-z][a-z0-9_]{1,40}" required />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Input name="titleEn" label={t.titleEn} maxLength={200} />
              <Textarea name="bodyEn" label={t.bodyEn} defaultValue="" />
            </div>
            <div className="flex flex-col gap-3">
              <Input name="titleBn" label={t.titleBn} maxLength={200} />
              <Textarea name="bodyBn" label={t.bodyBn} defaultValue="" />
            </div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
