import { buildTimetableGrid, hhmm, type GridPeriod } from "@/lib/timetable/grid";
import type { TimetableEntryRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";

/** Period rows × weekday columns. Presentational: the caller decides which entries to pass (already RLS-scoped). */
export function TimetableGridView({
  periods,
  entries,
  locale,
  subjectName,
  breakLabel,
  periodLabel,
  extra,
}: {
  periods: GridPeriod[];
  entries: TimetableEntryRow[];
  locale: string;
  subjectName: ReadonlyMap<string, string>;
  breakLabel: string;
  periodLabel: string;
  /** Optional second line / controls inside a lesson cell (room, section, delete button …). */
  extra?: (entry: TimetableEntryRow) => React.ReactNode;
}) {
  const grid = buildTimetableGrid(periods, entries);
  // 2024-01-07 was a Sunday, so weekday n == January (7 + n), 2024.
  const dayName = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const num = new Intl.NumberFormat(locale);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-24 p-1 text-left font-medium text-slate-400">{periodLabel}</th>
            {grid.days.map((d) => (
              <th key={d} className="p-1 text-center font-medium text-brand-navy">
                {dayName.format(new Date(Date.UTC(2024, 0, 7 + d)))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(({ period, cells }) => (
            <tr key={period.id}>
              <th scope="row" className="p-1 text-left align-top font-normal">
                <span className="block font-medium text-brand-navy">{period.label}</span>
                <span className="text-slate-400">{hhmm(period.start_time)}–{hhmm(period.end_time)}</span>
              </th>
              {period.is_break ? (
                <td colSpan={grid.days.length} className="rounded-lg bg-slate-100 p-2 text-center text-slate-500">
                  {breakLabel}
                </td>
              ) : (
                cells.map((entry, i) => (
                  <td
                    key={grid.days[i]}
                    className={cn(
                      "h-14 rounded-lg p-1.5 align-top",
                      entry ? "bg-brand-green-light text-brand-green-dark" : "bg-slate-50 text-slate-300",
                    )}
                  >
                    {entry ? (
                      <>
                        <span className="block font-medium">{subjectName.get(entry.subject_id) ?? "?"}</span>
                        {entry.room && <span className="block opacity-80">{entry.room}</span>}
                        {extra?.(entry)}
                      </>
                    ) : null}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">{num.format(grid.rows.length)}</span>
    </div>
  );
}
