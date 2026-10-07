import { gradeFor, lowestBand, roundTo, type GradeBand } from "./grading";

export interface ResultInput {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  /** null when the student was absent. */
  marks: number | null;
  isAbsent: boolean;
}

export interface SubjectGrade {
  subjectId: string;
  subjectName: string;
  obtained: number;
  max: number;
  percentage: number;
  letter: string;
  gradePoint: number;
  isPass: boolean;
  absentCount: number;
}

export interface ReportCard {
  subjects: SubjectGrade[];
  totalObtained: number;
  totalMax: number;
  percentage: number | null;
  gpa: number | null;
  letter: string | null;
  /** null when there is nothing to grade. */
  passed: boolean | null;
}

/**
 * Per subject: sum of marks over sum of maximums (an absence counts as 0 marks but
 * still counts toward the maximum). Overall: GPA = mean of subject grade points;
 * failing ANY subject fails the overall result (GPA 0, lowest band's letter), the
 * usual Bangladeshi rule. Grade/letter come only from the supplied bands.
 */
export function computeReportCard(results: readonly ResultInput[], bands: readonly GradeBand[]): ReportCard {
  const bySubject = new Map<string, { name: string; obtained: number; max: number; absent: number }>();
  for (const r of results) {
    if (r.maxMarks <= 0) continue;
    const entry = bySubject.get(r.subjectId) ?? { name: r.subjectName, obtained: 0, max: 0, absent: 0 };
    entry.obtained += r.isAbsent ? 0 : (r.marks ?? 0);
    entry.max += r.maxMarks;
    entry.absent += r.isAbsent ? 1 : 0;
    bySubject.set(r.subjectId, entry);
  }

  const subjects: SubjectGrade[] = [];
  for (const [subjectId, e] of bySubject) {
    const percentage = roundTo((e.obtained / e.max) * 100, 2);
    const band = gradeFor(percentage, bands);
    subjects.push({
      subjectId,
      subjectName: e.name,
      obtained: roundTo(e.obtained, 2),
      max: roundTo(e.max, 2),
      percentage,
      letter: band?.letter ?? "—",
      gradePoint: band?.grade_point ?? 0,
      isPass: band?.is_pass ?? false,
      absentCount: e.absent,
    });
  }
  subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  if (subjects.length === 0) {
    return { subjects, totalObtained: 0, totalMax: 0, percentage: null, gpa: null, letter: null, passed: null };
  }

  const totalObtained = roundTo(subjects.reduce((n, s) => n + s.obtained, 0), 2);
  const totalMax = roundTo(subjects.reduce((n, s) => n + s.max, 0), 2);
  const percentage = roundTo((totalObtained / totalMax) * 100, 2);
  const passed = subjects.every((s) => s.isPass);

  const gpa = passed ? roundTo(subjects.reduce((n, s) => n + s.gradePoint, 0) / subjects.length, 2) : 0;
  const letter = passed ? (gradeFor(percentage, bands)?.letter ?? null) : (lowestBand(bands)?.letter ?? null);

  return { subjects, totalObtained, totalMax, percentage, gpa, letter, passed };
}
