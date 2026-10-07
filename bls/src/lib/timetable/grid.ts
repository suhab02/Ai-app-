export interface GridPeriod {
  id: string;
  period_no: number;
  label: string;
  start_time: string;
  end_time: string;
  is_break: boolean;
}

export interface GridEntry {
  weekday: number;
  period_id: string;
}

export interface TimetableGrid<E extends GridEntry> {
  /** Weekdays shown as columns, 0 = Sunday. */
  days: number[];
  rows: { period: GridPeriod; cells: (E | null)[] }[];
}

/** Sunday–Thursday always; any other day (e.g. Saturday classes) appears only if it has a lesson. */
export const BASE_DAYS = [0, 1, 2, 3, 4];

export const hhmm = (time: string): string => time.slice(0, 5);

/**
 * Pivots flat entries into period rows × weekday columns. A slot holds at most one
 * entry (the database enforces one lesson per section per slot, and one place per
 * teacher per slot), so if input somehow collides the first one wins.
 */
export function buildTimetableGrid<E extends GridEntry>(
  periods: readonly GridPeriod[],
  entries: readonly E[],
): TimetableGrid<E> {
  const days = [...new Set([...BASE_DAYS, ...entries.map((e) => e.weekday)])]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b);

  const slot = new Map<string, E>();
  for (const entry of entries) {
    const key = `${entry.period_id}:${entry.weekday}`;
    if (!slot.has(key)) slot.set(key, entry);
  }

  const rows = [...periods]
    .sort((a, b) => a.period_no - b.period_no)
    .map((period) => ({ period, cells: days.map((day) => slot.get(`${period.id}:${day}`) ?? null) }));

  return { days, rows };
}
