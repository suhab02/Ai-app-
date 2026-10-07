"use server";

import * as z from "zod";
import { runStaff, type ActionResult } from "@/lib/server-actions";

const ContentSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, { error: "Key: lowercase letters, digits and underscores, starting with a letter." }),
  titleEn: z.string().trim().max(200),
  titleBn: z.string().trim().max(200),
  bodyEn: z.string().trim().max(10000),
  bodyBn: z.string().trim().max(10000),
});

/**
 * Website blocks are plain text only: the public pages render them as text (React escapes it), never as
 * HTML or Markdown, so a compromised or careless editor cannot inject script into the public site.
 */
export async function saveSiteContent(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, ContentSchema, ["/", "/about", "/contact", "/admissions", "/dashboard/admin/website"], "Content saved.", (i, db) =>
    db.from("site_content").upsert(
      { key: i.key, title_en: i.titleEn, title_bn: i.titleBn, body_en: i.bodyEn, body_bn: i.bodyBn },
      { onConflict: "key" },
    ),
  );
}
