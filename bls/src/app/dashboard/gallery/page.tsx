import Image from "next/image";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { requireStaff } from "@/lib/auth/dal";
import { createAlbum, deletePhoto, setAlbumPublished, uploadPhoto } from "@/lib/gallery/actions";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { createClient } from "@/lib/supabase/server";
import { Checkbox } from "@/components/admin/action-form";

export default async function GalleryAdminPage() {
  await requireStaff();
  const d = getDictionary(await getLocale());
  const t = d.gallery;
  const db = await createClient();

  const [albums, photos] = await Promise.all([
    db.from("gallery_albums").select("*").order("created_at", { ascending: false }),
    db.from("gallery_photos").select("*").order("created_at", { ascending: false }),
  ]);
  const urlFor = (path: string) => db.storage.from("gallery-public").getPublicUrl(path).data.publicUrl;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{t.title}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t.newAlbum}</CardTitle></CardHeader>
          <ActionForm action={createAlbum} submitLabel={t.create}>
            <Input name="title" label={t.albumTitle} required />
            <Input name="titleBn" label={t.albumTitleBn} />
            <Input name="description" label={t.description} />
            <Checkbox name="isPublished" label={t.published} />
          </ActionForm>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.upload}</CardTitle></CardHeader>
          <ActionForm action={uploadPhoto} submitLabel={t.upload}>
            <Select name="albumId" label={t.album} required defaultValue="">
              <option value="" disabled>{t.choose}</option>
              {albums.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </Select>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="file" className="text-sm font-medium text-brand-navy">{t.image}</label>
              <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
            </div>
            <Input name="caption" label={t.caption} />
          </ActionForm>
        </Card>
      </div>

      {!albums.data?.length ? (
        <Card><p className="text-sm text-slate-500">{t.noAlbums}</p></Card>
      ) : (
        albums.data.map((album) => {
          const own = photos.data?.filter((p) => p.album_id === album.id) ?? [];
          return (
            <Card key={album.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-navy">{album.title}{album.title_bn ? ` · ${album.title_bn}` : ""}</p>
                  {album.description && <p className="text-xs text-slate-500">{album.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={album.is_published ? "green" : "orange"}>{album.is_published ? t.published : t.draft}</Badge>
                  <ActionForm action={setAlbumPublished} submitLabel={album.is_published ? t.unpublish : t.publish} compact>
                    <input type="hidden" name="id" value={album.id} />
                    <input type="hidden" name="publish" value={album.is_published ? "false" : "true"} />
                  </ActionForm>
                </div>
              </div>
              {own.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t.noPhotos}</p>
              ) : (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {own.map((p) => (
                    <li key={p.id} className="flex flex-col gap-1">
                      <Image src={urlFor(p.storage_path)} alt={p.caption ?? album.title} width={240} height={180} unoptimized className="h-28 w-full rounded-xl object-cover" />
                      {p.caption && <span className="truncate text-xs text-slate-500">{p.caption}</span>}
                      <ActionForm action={deletePhoto} submitLabel={t.delete} compact>
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
