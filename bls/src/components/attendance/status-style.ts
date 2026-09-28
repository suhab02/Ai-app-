import type { AttendanceStatus } from "@/lib/supabase/types";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "LEAVE"];

// Full class strings (not built dynamically) so Tailwind can see them.
export const STATUS_BADGE: Record<AttendanceStatus, string> = {
  PRESENT: "bg-brand-green-light text-brand-green-dark",
  ABSENT: "bg-red-50 text-red-700",
  LATE: "bg-brand-orange-light text-brand-orange-dark",
  EXCUSED: "bg-sky-50 text-sky-700",
  LEAVE: "bg-violet-50 text-violet-700",
};

export const STATUS_CHECKED: Record<AttendanceStatus, string> = {
  PRESENT: "peer-checked:border-brand-green peer-checked:bg-brand-green peer-checked:text-white",
  ABSENT: "peer-checked:border-red-600 peer-checked:bg-red-600 peer-checked:text-white",
  LATE: "peer-checked:border-brand-orange peer-checked:bg-brand-orange peer-checked:text-white",
  EXCUSED: "peer-checked:border-sky-600 peer-checked:bg-sky-600 peer-checked:text-white",
  LEAVE: "peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white",
};
