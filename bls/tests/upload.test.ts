import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, sniffImage, validateImageUpload } from "../src/lib/gallery/upload";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<script>alert(1)</script>");

const file = (name: string, type: string, bytes: Uint8Array) => ({ name, type, size: bytes.length });

describe("sniffImage", () => {
  it("recognises the three allowed formats by their bytes", () => {
    expect(sniffImage(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(WEBP)?.mime).toBe("image/webp");
  });
  it("rejects anything else, including a RIFF container that isn't WebP", () => {
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("validateImageUpload", () => {
  it("accepts a real image whose name, type and bytes agree", () => {
    expect(validateImageUpload(file("a.jpg", "image/jpeg", JPEG), JPEG)).toMatchObject({ ok: true, kind: { ext: "jpg" } });
    expect(validateImageUpload(file("A.JPEG", "image/jpeg", JPEG), JPEG)).toMatchObject({ ok: true, kind: { ext: "jpg" } });
    expect(validateImageUpload(file("b.png", "image/png", PNG), PNG).ok).toBe(true);
    expect(validateImageUpload(file("c.webp", "", WEBP), WEBP).ok).toBe(true); // some browsers send no type
  });

  it("rejects a script renamed to .jpg", () => {
    expect(validateImageUpload(file("evil.jpg", "image/jpeg", HTML), HTML).ok).toBe(false);
  });

  it("rejects a PNG disguised as a JPEG (bytes and extension disagree)", () => {
    expect(validateImageUpload(file("x.jpg", "image/jpeg", PNG), PNG).ok).toBe(false);
  });

  it("rejects a lying Content-Type", () => {
    expect(validateImageUpload(file("x.png", "text/html", PNG), PNG).ok).toBe(false);
  });

  it("rejects disallowed extensions, no extension, and double extensions", () => {
    expect(validateImageUpload(file("x.gif", "image/gif", PNG), PNG).ok).toBe(false);
    expect(validateImageUpload(file("x.svg", "image/svg+xml", PNG), PNG).ok).toBe(false);
    expect(validateImageUpload(file("noext", "image/png", PNG), PNG).ok).toBe(false);
    expect(validateImageUpload(file("x.png.exe", "image/png", PNG), PNG).ok).toBe(false);
  });

  it("enforces the size limit and rejects empty files", () => {
    expect(validateImageUpload({ name: "x.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 }, PNG).ok).toBe(false);
    expect(validateImageUpload({ name: "x.png", type: "image/png", size: 0 }, new Uint8Array()).ok).toBe(false);
  });
});
