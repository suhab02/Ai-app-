export interface GradeBand {
  letter: string;
  min_score: number;
  grade_point: number;
  is_pass: boolean;
}

/**
 * A band covers every percentage >= its min_score up to the next band's min_score,
 * so the bands from the database (never hard-coded here) can't overlap or leave gaps.
 */
export function gradeFor(percentage: number, bands: readonly GradeBand[]): GradeBand | null {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  return sorted.find((band) => percentage >= band.min_score) ?? null;
}

export function lowestBand(bands: readonly GradeBand[]): GradeBand | null {
  return [...bands].sort((a, b) => a.min_score - b.min_score)[0] ?? null;
}

export const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
