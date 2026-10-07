import Image from "next/image";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createClient } from "@/lib/supabase/server";

export default async function PublicGalleryPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const db = await createClient();

  // Anonymous read: RLS returns only published albums and their photos.
  const [albums, photos] = await Promise.all([
    db.from("gallery_albums").select("id, title, title_bn, description").order("created_at", { ascending: false }),
    db.from("gallery_photos").select("id, album_id, storage_path, caption, caption_bn").order("sort_order").order("created_at", { ascending: false }),
  ]);
  const urlFor = (path: string) => db.storage.from("gallery-public").getPublicUrl(path).data.publicUrl;

  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy">{d.gallery.title}</h1>
      {!albums.data?.length ? <p className="text-sm text-slate-500">{d.public.noPhotos}</p> : albums.data.map((album) => {
        const own = photos.data?.filter((p) => p.album_id === album.id) ?? [];
        return (
          <section key={album.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-brand-navy">{(locale === "bn" && album.title_bn) || album.title}</h2>
            {album.description && <p className="text-sm text-slate-600">{album.description}</p>}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {own.map((p) => (
                <li key={p.id}>
                  <Image src={urlFor(p.storage_path)} alt={(locale === "bn" && p.caption_bn) || p.caption || album.title} width={320} height={240} unoptimized className="h-36 w-full rounded-2xl object-cover" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
