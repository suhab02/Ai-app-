import { describe, expect, it } from "vitest";
import { gradeFor, type GradeBand } from "../src/lib/results/grading";
import { computeReportCard, type ResultInput } from "../src/lib/results/report-card";

// The Bangladesh default from migration 0008.
const BANDS: GradeBand[] = [
  { letter: "A+", min_score: 80, grade_point: 5, is_pass: true },
  { letter: "A", min_score: 70, grade_point: 4, is_pass: true },
  { letter: "A-", min_score: 60, grade_point: 3.5, is_pass: true },
  { letter: "B", min_score: 50, grade_point: 3, is_pass: true },
  { letter: "C", min_score: 40, grade_point: 2, is_pass: true },
  { letter: "D", min_score: 33, grade_point: 1, is_pass: true },
  { letter: "F", min_score: 0, grade_point: 0, is_pass: false },
];

const r = (subjectId: string, marks: number | null, maxMarks = 100, isAbsent = false): ResultInput => ({
  subjectId, subjectName: subjectId, maxMarks, marks, isAbsent,
});

describe("gradeFor", () => {
  it.each([
    [100, "A+"], [80, "A+"], [79.99, "A"], [70, "A"], [60, "A-"], [50, "B"], [40, "C"], [33, "D"], [32.99, "F"], [0, "F"],
  ])("%d%% is %s", (pct, letter) => {
    expect(gradeFor(pct, BANDS)?.letter).toBe(letter);
  });

  it("is driven by the supplied bands, not hard-coded ones", () => {
    const custom: GradeBand[] = [
      { letter: "Pass", min_score: 50, grade_point: 1, is_pass: true },
      { letter: "Fail", min_score: 0, grade_point: 0, is_pass: false },
    ];
    expect(gradeFor(75, custom)?.letter).toBe("Pass");
    expect(gradeFor(49, custom)?.letter).toBe("Fail");
  });

  it("returns null with no bands", () => expect(gradeFor(50, [])).toBeNull());
});

describe("computeReportCard", () => {
  it("returns an empty card with nothing to grade", () => {
    expect(computeReportCard([], BANDS)).toMatchObject({ percentage: null, gpa: null, letter: null, passed: null });
  });

  it("sums marks over maximums per subject, across assessments", () => {
    const card = computeReportCard([r("math", 40, 50), r("math", 45, 50), r("eng", 70)], BANDS);
    const math = card.subjects.find((s) => s.subjectId === "math")!;
    expect(math).toMatchObject({ obtained: 85, max: 100, percentage: 85, letter: "A+" });
    expect(card.totalObtained).toBe(155);
    expect(card.totalMax).toBe(200);
    expect(card.percentage).toBe(77.5);
  });

  it("averages grade points into a GPA when everything passes", () => {
    const card = computeReportCard([r("math", 85), r("eng", 72), r("ban", 65)], BANDS);
    expect(card.passed).toBe(true);
    expect(card.gpa).toBe(4.17); // (5 + 4 + 3.5) / 3
  });

  it("fails the overall result if any subject fails, even with a high average", () => {
    const card = computeReportCard([r("math", 100), r("eng", 100), r("sci", 20)], BANDS);
    expect(card).toMatchObject({ passed: false, gpa: 0, letter: "F" });
    expect(card.percentage).toBeGreaterThan(70);
  });

  it("counts an absence as zero marks but keeps the maximum", () => {
    const card = computeReportCard([r("math", 60), r("math", null, 100, true)], BANDS);
    expect(card.subjects[0]).toMatchObject({ obtained: 60, max: 200, percentage: 30, absentCount: 1, letter: "F" });
  });

  it("ignores assessments with a non-positive maximum", () => {
    expect(computeReportCard([r("math", 5, 0)], BANDS).subjects).toHaveLength(0);
  });
});
