import { describe, expect, it } from "vitest";
import { buildTimetableGrid, hhmm, type GridPeriod } from "../src/lib/timetable/grid";

const periods: GridPeriod[] = [
  { id: "p2", period_no: 2, label: "Period 2", start_time: "09:50:00", end_time: "10:35:00", is_break: false },
  { id: "p1", period_no: 1, label: "Period 1", start_time: "09:00:00", end_time: "09:45:00", is_break: false },
  { id: "pb", period_no: 3, label: "Recess", start_time: "10:35:00", end_time: "11:00:00", is_break: true },
];

describe("buildTimetableGrid", () => {
  it("orders rows by period number and shows Sunday–Thursday by default", () => {
    const grid = buildTimetableGrid(periods, []);
    expect(grid.rows.map((r) => r.period.id)).toEqual(["p1", "p2", "pb"]);
    expect(grid.days).toEqual([0, 1, 2, 3, 4]);
    expect(grid.rows[0].cells).toEqual([null, null, null, null, null]);
  });

  it("places an entry in its period row and weekday column", () => {
    const e = { weekday: 2, period_id: "p2", subject: "Math" };
    const grid = buildTimetableGrid(periods, [e]);
    expect(grid.rows[1].cells[2]).toBe(e);
    expect(grid.rows[0].cells[2]).toBeNull();
  });

  it("adds a column for an out-of-week day that has a lesson", () => {
    const grid = buildTimetableGrid(periods, [{ weekday: 6, period_id: "p1" }]);
    expect(grid.days).toEqual([0, 1, 2, 3, 4, 6]);
    expect(grid.rows[0].cells[5]).not.toBeNull();
  });

  it("keeps the first entry if a slot is somehow duplicated", () => {
    const a = { weekday: 0, period_id: "p1", id: "a" };
    const b = { weekday: 0, period_id: "p1", id: "b" };
    expect(buildTimetableGrid(periods, [a, b]).rows[0].cells[0]).toBe(a);
  });

  it("ignores impossible weekdays", () => {
    expect(buildTimetableGrid(periods, [{ weekday: 9, period_id: "p1" }]).days).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("hhmm", () => {
  it("trims seconds", () => expect(hhmm("09:05:00")).toBe("09:05"));
});
