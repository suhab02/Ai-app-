import type { AttendanceStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";
import { STATUS_BADGE } from "./status-style";

/** Month grid (Sunday-first) colouring each recorded day by status. Pure/presentational. */
export function AttendanceCalendar({
  month,
  statusByDate,
  locale,
  statusLabels,
}: {
  month: string; // YYYY-MM
  statusByDate: ReadonlyMap<string, AttendanceStatus>;
  locale: string;
  statusLabels: Record<AttendanceStatus, string>;
}) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const offset = first.getUTCDay();

  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFormat.format(new Date(Date.UTC(2024, 0, 7 + i))));
  const numberFormat = new Intl.NumberFormat(locale);

  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid">
      {weekdays.map((w) => (
        <div key={w} className="py-1 font-medium text-slate-400">{w}</div>
      ))}
      {cells.map((day, i) => {
        if (day === null) return <div key={`blank-${i}`} />;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const status = statusByDate.get(date);
        return (
          <div
            key={date}
            title={status ? statusLabels[status] : undefined}
            className={cn("flex h-9 items-center justify-center rounded-lg", status ? STATUS_BADGE[status] : "text-slate-400")}
          >
            {numberFormat.format(day)}
          </div>
        );
      })}
    </div>
  );
}
