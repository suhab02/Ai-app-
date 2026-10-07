import { ContentBlock } from "@/components/public/content-block";
import { getLocale } from "@/lib/i18n/get-locale";
import { getSiteContent, pick } from "@/lib/site/content";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const locale = await getLocale();
  const block = (await getSiteContent(await createClient())).get("contact");
  return <ContentBlock title={pick(locale, block?.title_en ?? "", block?.title_bn ?? "")} body={pick(locale, block?.body_en ?? "", block?.body_bn ?? "")} />;
}
