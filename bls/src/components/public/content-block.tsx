/** Renders a CMS block as plain text. Paragraphs are split on blank lines; nothing is ever parsed as HTML or Markdown. */
export function ContentBlock({ title, body, titleTag: Tag = "h1" }: { title: string; body: string; titleTag?: "h1" | "h2" }) {
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="flex flex-col gap-3">
      {title && <Tag className="text-2xl font-semibold text-brand-navy sm:text-3xl">{title}</Tag>}
      {paragraphs.map((p, i) => (
        <p key={i} className="max-w-prose whitespace-pre-line text-base leading-relaxed text-slate-700">{p}</p>
      ))}
    </section>
  );
}
