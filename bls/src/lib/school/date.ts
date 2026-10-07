const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in the school's timezone, Asia/Dhaka (UTC+6, no DST). Mirrors public.school_today(). */
export function schoolToday(now: number = Date.now()): string {
  return new Date(now + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const isIsoDate = (value: string | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Current time in ms. Server Components render per request, so reading the clock is intended; this keeps that explicit. */
export const nowMs = (): number => Date.now();
