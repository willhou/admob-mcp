export interface DateObj {
  year: number;
  month: number;
  day: number;
}

export function daysAgo(n: number): DateObj {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function today(): DateObj {
  return daysAgo(0);
}

export function yesterday(): DateObj {
  return daysAgo(1);
}

/** Parse rows from AdMob API streaming response (array of header/row/footer objects). */
export function parseReportRows(response: unknown): Array<Record<string, string>> {
  const items = Array.isArray(response) ? response : [response];
  const rows: Array<Record<string, string>> = [];

  for (const item of items) {
    const row = (item as any)?.row;
    if (!row) continue;

    const parsed: Record<string, string> = {};

    if (row.dimensionValues) {
      for (const [key, val] of Object.entries(row.dimensionValues)) {
        const v = val as any;
        parsed[key] = v.displayLabel || v.value || "";
      }
    }

    if (row.metricValues) {
      for (const [key, val] of Object.entries(row.metricValues)) {
        const v = val as any;
        // AdMob MetricValue uses a different field per value type:
        //   - microsValue: currency amounts, eCPM, RPM (in account-currency micros) -> divide by 1,000,000
        //   - integerValue: counts such as impressions and requests
        //   - doubleValue: ratios such as match rate and CTR (0..1)
        // Treating every metric as micros rounds ratios down to 0 and corrupts magnitudes.
        if (v.microsValue != null) {
          parsed[key] = String(Number(v.microsValue) / 1_000_000);
        } else if (v.integerValue != null) {
          parsed[key] = String(v.integerValue);
        } else if (v.doubleValue != null) {
          parsed[key] = String(v.doubleValue);
        } else {
          parsed[key] = String(v.value ?? "");
        }
      }
    }

    rows.push(parsed);
  }

  return rows;
}

/** Display symbol per currency code. Unknown codes fall back to using the code itself as a prefix. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  BRL: "R$",
  KRW: "₩",
  MXN: "$",
  SEK: "kr ",
  PLN: "zł ",
};

/** Currency codes whose smallest unit is an integer (no decimal places). */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

/**
 * Rate metrics measured per-mille (per 1000 impressions/requests). They are
 * fractional regardless of the account currency, so they keep decimal places
 * even for zero-decimal currencies.
 */
const RATE_METRICS = new Set(["OBSERVED_ECPM", "IMPRESSION_RPM"]);

/** Metric keys representing integer counts; their averages are rounded for display. */
const COUNT_METRICS = new Set(["IMPRESSIONS", "AD_REQUESTS", "MATCHED_REQUESTS", "CLICKS"]);

/**
 * Format a numeric value as a currency string.
 * Falls back to `$` when currencyCode is omitted, for backward compatibility.
 *
 * Set `alwaysDecimals` for rate metrics (eCPM, RPM): these are fractional even
 * in zero-decimal currencies like JPY/KRW, so a 0.49 ¥ eCPM must render as
 * `¥0.49`, not `¥0`. Sub-cent rates (e.g. 0.0049) keep extra precision instead
 * of collapsing to a misleading 0.00.
 */
export function formatCurrency(
  value: string | number,
  currencyCode?: string,
  options?: { alwaysDecimals?: boolean }
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const code = currencyCode?.toUpperCase();
  const symbol = (code && CURRENCY_SYMBOLS[code]) || (code ? `${code} ` : "$");
  if (isNaN(num)) return `${symbol}0`;
  const zeroDecimal = !options?.alwaysDecimals && !!code && ZERO_DECIMAL_CURRENCIES.has(code);
  // A small but non-zero rate would round to 0.00 at two decimals; show 4 so it stays visible.
  const subCentRate = !!options?.alwaysDecimals && num !== 0 && Number(num.toFixed(2)) === 0;
  const fractionDigits = zeroDecimal ? 0 : subCentRate ? 4 : 2;
  return `${symbol}${num.toFixed(fractionDigits)}`;
}

/** Extract the account currency code from an AdMob report response header. */
export function extractCurrencyCode(response: unknown): string | undefined {
  const items = Array.isArray(response) ? response : [response];
  for (const item of items) {
    const code = (item as any)?.header?.localizationSettings?.currencyCode;
    if (code) return String(code);
  }
  return undefined;
}

/** Format a parsed report as a readable table string. */
export function formatReportTable(
  rows: Array<Record<string, string>>,
  options?: {
    earningsKeys?: string[];
    title?: string;
    currency?: string;
  }
): string {
  if (rows.length === 0) return options?.title ? `${options.title}\n\nNo data found.` : "No data found.";

  const earningsKeys = options?.earningsKeys || ["ESTIMATED_EARNINGS", "OBSERVED_ECPM", "IMPRESSION_RPM"];

  // Match a column to its base currency/rate metric, allowing comparison suffixes
  // (e.g. ESTIMATED_EARNINGS_NOW, IMPRESSION_RPM_LAST_YR). Percentage-change columns
  // (_CHG, _YOY, …) carry non-numeric values ("+5%", "N/A", "-") and are skipped by
  // the numeric guard, so they keep their raw string instead of being formatted as money.
  const currencyMetricFor = (key: string): string | undefined =>
    earningsKeys.find((base) => key === base || key.startsWith(`${base}_`));
  const isNumeric = (v: string): boolean =>
    v !== "" && !v.includes("%") && Number.isFinite(Number(v));

  // Format currency / eCPM / RPM columns in the account currency (rows are already real numbers from parseReportRows)
  const formatted = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const base = currencyMetricFor(k);
      out[k] =
        base && isNumeric(v)
          ? formatCurrency(v, options?.currency, { alwaysDecimals: RATE_METRICS.has(base) })
          : v;
    }
    return out;
  });

  const keys = Object.keys(formatted[0]);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const k of keys) {
    widths[k] = Math.max(k.length, ...formatted.map((r) => (r[k] || "").length));
  }

  const header = keys.map((k) => k.padEnd(widths[k])).join(" | ");
  const separator = keys.map((k) => "-".repeat(widths[k])).join("-+-");
  const body = formatted
    .map((row) => keys.map((k) => (row[k] || "").padEnd(widths[k])).join(" | "))
    .join("\n");

  const table = `${header}\n${separator}\n${body}`;
  return options?.title ? `${options.title}\n\n${table}` : table;
}

/** Compute % change between two numeric strings. */
export function pctChange(prev: string | number, curr: string | number): string {
  const p = typeof prev === "string" ? parseFloat(prev) : prev;
  const c = typeof curr === "string" ? parseFloat(curr) : curr;
  if (isNaN(p) || isNaN(c) || p === 0) return "N/A";
  const pct = ((c - p) / Math.abs(p)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/**
 * Average each metric across rows. Count metrics (impressions, requests, …) are
 * rounded to whole numbers; currency and rate metrics keep their fractional
 * precision so values like 0.49 average earnings or 2.34 RPM are not collapsed
 * to 0/2 before formatting.
 */
export function averageMetrics(
  rows: Array<Record<string, string>>,
  metricKeys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of metricKeys) {
    const sum = rows.reduce((s, r) => s + parseFloat(r[key] || "0"), 0);
    const avg = rows.length === 0 ? 0 : sum / rows.length;
    out[key] = COUNT_METRICS.has(key) ? String(Math.round(avg)) : String(avg);
  }
  return out;
}

/** Add period-over-period change columns to time-series rows. */
export function addPeriodChanges(
  rows: Array<Record<string, string>>,
  metricKeys: string[]
): void {
  for (let i = rows.length - 1; i >= 1; i--) {
    for (const key of metricKeys) {
      rows[i][`${key}_CHANGE`] = pctChange(rows[i - 1][key], rows[i][key]);
    }
  }
  if (rows.length > 0) {
    for (const key of metricKeys) {
      rows[0][`${key}_CHANGE`] = "-";
    }
  }
}
