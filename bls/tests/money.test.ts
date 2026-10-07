import { describe, expect, it } from "vitest";
import { formatMoney, fromPaisa, hasValidPrecision, summarizeInvoice, toPaisa } from "../src/lib/fees/money";

describe("paisa arithmetic", () => {
  it("avoids floating-point drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the JS problem we are avoiding
    expect(fromPaisa(toPaisa(0.1) + toPaisa(0.2))).toBe(0.3);
  });

  it("validates at most two decimals", () => {
    expect(hasValidPrecision(2000)).toBe(true);
    expect(hasValidPrecision(19.99)).toBe(true);
    expect(hasValidPrecision(19.999)).toBe(false);
    expect(hasValidPrecision(Number.NaN)).toBe(false);
  });
});

describe("formatMoney", () => {
  it("matches the receipt design: ৳ 2,000", () => expect(formatMoney(2000)).toBe("৳ 2,000"));
  it("shows paisa only when present", () => {
    expect(formatMoney(2000.5)).toBe("৳ 2,000.50");
    expect(formatMoney(75)).toBe("৳ 75");
  });
  it("uses Bangla digits for bn", () => expect(formatMoney(2000, "bn")).toBe("৳ ২,০০০"));
});

describe("summarizeInvoice", () => {
  const invoice = { amount_due: 2000, due_date: "2026-03-10", voided_at: null };

  it("is UNPAID before the due date with no payments", () => {
    expect(summarizeInvoice(invoice, [], "2026-03-01")).toEqual({ paid: 0, balance: 2000, state: "UNPAID" });
  });

  it("is PARTIAL after a part payment", () => {
    expect(summarizeInvoice(invoice, [{ amount: 1200, status: "PAID" }], "2026-03-01")).toEqual({ paid: 1200, balance: 800, state: "PARTIAL" });
  });

  it("is PAID when fully covered, even past the due date", () => {
    const s = summarizeInvoice(invoice, [{ amount: 1200, status: "PAID" }, { amount: 800, status: "PARTIAL" }], "2026-04-01");
    expect(s).toEqual({ paid: 2000, balance: 0, state: "PAID" });
  });

  it("is OVERDUE when a balance remains past the due date", () => {
    expect(summarizeInvoice(invoice, [{ amount: 500, status: "PAID" }], "2026-03-11").state).toBe("OVERDUE");
  });

  it("ignores pending, failed and refunded payments", () => {
    const s = summarizeInvoice(invoice, [
      { amount: 500, status: "PENDING" },
      { amount: 500, status: "FAILED" },
      { amount: 2000, status: "REFUNDED" },
    ], "2026-03-01");
    expect(s).toEqual({ paid: 0, balance: 2000, state: "UNPAID" });
  });

  it("a voided invoice is VOID whatever else is true", () => {
    expect(summarizeInvoice({ ...invoice, voided_at: "2026-03-02T00:00:00Z" }, [], "2026-05-01").state).toBe("VOID");
  });

  it("sums decimals exactly", () => {
    const s = summarizeInvoice({ ...invoice, amount_due: 0.3 }, [{ amount: 0.1, status: "PAID" }, { amount: 0.2, status: "PAID" }], "2026-03-01");
    expect(s).toMatchObject({ paid: 0.3, balance: 0, state: "PAID" });
  });
});
