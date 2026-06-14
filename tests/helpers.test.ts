import { describe, it, expect } from "vitest";
import { formatCurrency, formatReportTable, averageMetrics } from "../src/helpers";

describe("formatCurrency", () => {
  it("formats USD with two decimals", () => {
    expect(formatCurrency("1.5", "USD")).toBe("$1.50");
  });

  it("falls back to $ with two decimals when no currency given", () => {
    expect(formatCurrency("1.5")).toBe("$1.50");
  });

  it("uses zero decimals for a JPY amount", () => {
    expect(formatCurrency("1234", "JPY")).toBe("¥1234");
  });

  it("keeps decimals for a zero-decimal currency when alwaysDecimals is set (rate metric)", () => {
    // A fractional eCPM/RPM rate must not be rounded to ¥0 just because JPY has no minor unit.
    expect(formatCurrency("0.49", "JPY", { alwaysDecimals: true })).toBe("¥0.49");
  });

  it("ignores alwaysDecimals for currencies that already show decimals", () => {
    expect(formatCurrency("0.49", "USD", { alwaysDecimals: true })).toBe("$0.49");
  });
});

describe("formatReportTable", () => {
  it("keeps decimals on rate columns but not amount columns for zero-decimal currencies", () => {
    const rows = [
      { DATE: "20260101", ESTIMATED_EARNINGS: "1234", OBSERVED_ECPM: "0.49", IMPRESSION_RPM: "2.34" },
    ];
    const table = formatReportTable(rows, { currency: "JPY" });
    // Amount stays whole; rate columns keep their fractional precision.
    expect(table).toContain("¥1234");
    expect(table).toContain("¥0.49");
    expect(table).toContain("¥2.34");
    expect(table).not.toContain("¥0 ");
    expect(table).not.toContain("¥2 ");
  });
});

describe("formatReportTable with comparison (suffixed) columns", () => {
  const rows = [
    {
      COUNTRY: "JP",
      ESTIMATED_EARNINGS_NOW: "1234",
      ESTIMATED_EARNINGS_PREV: "1000",
      ESTIMATED_EARNINGS_CHG: "+23.4%",
      IMPRESSION_RPM_LAST_YR: "2.34",
    },
  ];

  it("formats suffixed amount columns in the account currency (JPY, zero-decimal)", () => {
    const table = formatReportTable(rows, { currency: "JPY" });
    expect(table).toContain("¥1234");
    expect(table).toContain("¥1000");
  });

  it("keeps rate decimals on suffixed rate columns even for zero-decimal currencies", () => {
    const table = formatReportTable(rows, { currency: "JPY" });
    expect(table).toContain("¥2.34");
  });

  it("leaves percentage-change columns untouched", () => {
    const table = formatReportTable(rows, { currency: "JPY" });
    expect(table).toContain("+23.4%");
    // The change column must not be mistaken for currency.
    expect(table).not.toContain("¥23");
    expect(table).not.toContain("¥+");
  });

  it("formats suffixed columns for two-decimal currencies too", () => {
    const table = formatReportTable(rows, { currency: "USD" });
    expect(table).toContain("$1234.00");
    expect(table).toContain("$1000.00");
  });
});

describe("averageMetrics", () => {
  it("rounds count metrics but preserves fractional currency and rate metrics", () => {
    const rows = [
      { ESTIMATED_EARNINGS: "0.40", IMPRESSIONS: "100", IMPRESSION_RPM: "2.30" },
      { ESTIMATED_EARNINGS: "0.58", IMPRESSIONS: "101", IMPRESSION_RPM: "2.38" },
    ];
    const result = averageMetrics(rows, ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM"]);
    expect(result.ESTIMATED_EARNINGS).toBe("0.49");
    expect(result.IMPRESSION_RPM).toBe("2.34");
    expect(result.IMPRESSIONS).toBe("101"); // count metric rounded to nearest integer
  });

  it("returns zero for every metric when there are no rows", () => {
    const result = averageMetrics([], ["ESTIMATED_EARNINGS", "IMPRESSIONS"]);
    expect(result.ESTIMATED_EARNINGS).toBe("0");
    expect(result.IMPRESSIONS).toBe("0");
  });
});
