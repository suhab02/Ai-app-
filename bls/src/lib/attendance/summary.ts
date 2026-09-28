import type { AttendanceStatus } from "@/lib/supabase/types";

export interface AttendanceSummary {
  totalDays: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  leave: number;
  /** 0–100, or null when there is nothing to measure yet. */
  percentage: number | null;
}

/**
 * Percentage = (PRESENT + LATE) / (PRESENT + LATE + ABSENT).
 * EXCUSED and LEAVE are approved absences: they show in the counts but do not
 * count against the student. Rounded to one decimal place.
 */
export function summarizeAttendance(statuses: readonly AttendanceStatus[]): AttendanceSummary {
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEAVE: 0 };
  for (const status of statuses) counts[status] += 1;

  const measured = counts.PRESENT + counts.LATE + counts.ABSENT;
  const percentage = measured === 0 ? null : Math.round(((counts.PRESENT + counts.LATE) / measured) * 1000) / 10;

  return {
    totalDays: statuses.length,
    present: counts.PRESENT,
    absent: counts.ABSENT,
    late: counts.LATE,
    excused: counts.EXCUSED,
    leave: counts.LEAVE,
    percentage,
  };
}
