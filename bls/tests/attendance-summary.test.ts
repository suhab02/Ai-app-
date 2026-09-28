import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "../src/lib/attendance/summary";

describe("summarizeAttendance", () => {
  it("returns a null percentage when nothing is recorded", () => {
    expect(summarizeAttendance([])).toEqual({
      totalDays: 0, present: 0, absent: 0, late: 0, excused: 0, leave: 0, percentage: null,
    });
  });

  it("counts late as attended", () => {
    const s = summarizeAttendance(["PRESENT", "LATE", "ABSENT", "PRESENT"]);
    expect(s).toMatchObject({ totalDays: 4, present: 2, late: 1, absent: 1, percentage: 75 });
  });

  it("does not penalise excused or leave days", () => {
    const s = summarizeAttendance(["PRESENT", "EXCUSED", "LEAVE", "ABSENT"]);
    expect(s).toMatchObject({ totalDays: 4, excused: 1, leave: 1, percentage: 50 });
  });

  it("is null when every day is an approved absence", () => {
    expect(summarizeAttendance(["LEAVE", "EXCUSED"]).percentage).toBeNull();
  });

  it("rounds to one decimal", () => {
    expect(summarizeAttendance(["PRESENT", "PRESENT", "ABSENT"]).percentage).toBe(66.7);
  });
});
