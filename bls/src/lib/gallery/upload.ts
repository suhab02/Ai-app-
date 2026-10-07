/**
 * Validation for gallery uploads. This runs in the Server Action BEFORE anything is sent to
 * Storage, and the bucket repeats the MIME/size limits — two independent checks, because a
 * file's name, claimed MIME type and size are all attacker-controlled; only the bytes are real.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageKind = { ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" };

const KINDS: Record<string, ImageKind> = {
  jpg: { ext: "jpg", mime: "image/jpeg" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
};

/** Identify an image from its first bytes (JPEG, PNG or WebP); null if it is none of them. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const startsWith = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);

  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return KINDS.jpg;
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return KINDS.png;
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (bytes.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return KINDS.webp;
  return null;
}

export type UploadCheck = { ok: true; kind: ImageKind } | { ok: false; error: string };

/** The file must be an image whose bytes, extension and declared MIME type all agree, within the size limit. */
export function validateImageUpload(file: { name: string; type: string; size: number }, bytes: Uint8Array): UploadCheck {
  if (file.size <= 0 || bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 5 MB or smaller." };

  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const byExtension = KINDS[ext];
  if (!byExtension) return { ok: false, error: "Only JPG, PNG or WebP images are allowed." };

  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, error: "That file is not a valid JPG, PNG or WebP image." };
  if (sniffed.mime !== byExtension.mime) return { ok: false, error: "The file's contents do not match its extension." };
  if (file.type && file.type !== sniffed.mime) return { ok: false, error: "The file's declared type does not match its contents." };

  return { ok: true, kind: sniffed };
}
