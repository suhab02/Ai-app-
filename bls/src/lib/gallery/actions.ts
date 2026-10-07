"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { friendly, runStaff, type ActionResult } from "@/lib/server-actions";
import { validateImageUpload } from "./upload";

const BUCKET = "gallery-public";
const PATHS = ["/dashboard/gallery"];
const checkbox = z.string().optional().transform((v) => v === "on" || v === "true");
const optionalText = z.string().trim().max(500).optional().transform((v) => (v ? v : undefined));

const AlbumSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title." }).max(120),
  titleBn: optionalText,
  description: optionalText,
  isPublished: checkbox,
});

export async function createAlbum(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, AlbumSchema, PATHS, "Album created.", (i, db) =>
    db.from("gallery_albums").insert({
      title: i.title,
      title_bn: i.titleBn ?? null,
      description: i.description ?? null,
      is_published: i.isPublished,
    }),
  );
}

export async function setAlbumPublished(_prev: ActionResult, formData: FormData) {
  return runStaff(
    formData,
    z.object({ id: z.uuid(), publish: z.enum(["true", "false"]) }),
    PATHS,
    "Album updated.",
    (i, db) => db.from("gallery_albums").update({ is_published: i.publish === "true" }).eq("id", i.id),
  );
}

/**
 * Upload one image. Order matters:
 *   1. staff only  2. validate the BYTES (type, extension, size) before touching Storage
 *   3. a server-generated random object name (the client never picks a path)
 *   4. upload as the signed-in staff user — Storage RLS + the bucket's own limits apply again
 *   5. insert the row; if that fails, delete the object so nothing is orphaned
 */
export async function uploadPhoto(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireStaff();

  const albumId = z.uuid().safeParse(formData.get("albumId"));
  if (!albumId.success) return { error: "Choose an album." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImageUpload({ name: file.name, type: file.type, size: file.size }, bytes);
  if (!check.ok) return { error: check.error };

  const caption = optionalText.safeParse(formData.get("caption") ?? undefined);
  const photoId = crypto.randomUUID();
  const path = `albums/${albumId.data}/${photoId}.${check.kind.ext}`;

  const db = await createClient();
  const { data: album } = await db.from("gallery_albums").select("id").eq("id", albumId.data).maybeSingle();
  if (!album) return { error: "Album not found." };

  const uploaded = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: check.kind.mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (uploaded.error) return { error: uploaded.error.message };

  const { error } = await db
    .from("gallery_photos")
    .insert({ id: photoId, album_id: albumId.data, storage_path: path, caption: caption.success ? (caption.data ?? null) : null });
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    return { error: friendly(error) };
  }

  revalidatePath("/dashboard/gallery");
  revalidatePath("/gallery");
  return { ok: "Photo uploaded." };
}

export async function deletePhoto(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireStaff();

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid photo." };

  const db = await createClient();
  const { data, error } = await db.from("gallery_photos").delete().eq("id", id.data).select("storage_path");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Photo not found." };

  await db.storage.from(BUCKET).remove([data[0].storage_path]);
  revalidatePath("/dashboard/gallery");
  revalidatePath("/gallery");
  return { ok: "Photo deleted." };
}
