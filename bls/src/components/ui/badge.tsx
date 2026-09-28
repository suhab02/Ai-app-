import { cn } from "@/lib/utils/cn";

type BadgeTone = "green" | "orange" | "navy" | "red" | "slate";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-brand-green-light text-brand-green-dark",
  orange: "bg-brand-orange-light text-brand-orange-dark",
  navy: "bg-slate-100 text-brand-navy",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-600",
};

export function Badge({
  tone = "slate",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
