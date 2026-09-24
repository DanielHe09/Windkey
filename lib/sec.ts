import { CONCEPTS_BY_METRIC } from "./trim.mjs";

/** cost_of_revenue is not claimable; it exists to cross-check revenue and gross profit. */
export type Metric = "revenue" | "operating_income" | "net_income" | "gross_profit" | "cost_of_revenue";

export const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  net_income: "Net income",
  gross_profit: "Gross profit",
  cost_of_revenue: "Cost of revenue",
};

export const usd = (n: number) => `$${(n / 1e9).toFixed(3).replace(/\.?0+$/, "")}B`;

const CONCEPTS = CONCEPTS_BY_METRIC as Record<Metric, string[]>;

export interface Row {
  start: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  /** Fiscal year of the filing that reported this row (the company's own fiscal-year naming). */
  fy: number;
}

export interface Fact {
  metric: Metric;
  /** XBRL tag the value came from */
  concept: string;
  periodEnd: string;
  periodStart: string;
  value: number;
  accn: string;
  filed: string;
  url: string;
  /** Set when a later filing reports a different value for the same period. */
  restatedValue?: number;
}

export function filingUrl(cik: string, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll("-", "")}/${accn}-index.htm`;
}

/**
 * Annual value for a metric, matched by period END date (not the `fy` field, which
 * labels the filing, not the period). The same period is repeated as a comparative
 * in later 10-Ks; we cite the original filing and flag any later restatement.
 */
export function getFact(metric: Metric, periodEnd: string, data: Record<string, Row[]>, cik: string): Fact | null {
  for (const concept of CONCEPTS[metric]) {
    const matches = (data[concept] ?? []).filter((r) => r.end === periodEnd).sort((a, b) => a.filed.localeCompare(b.filed));
    if (!matches.length) continue;
    const original = matches[0];
    const latest = matches[matches.length - 1];
    return {
      metric,
      concept,
      periodEnd,
      periodStart: original.start,
      value: original.val,
      accn: original.accn,
      filed: original.filed,
      url: filingUrl(cik, original.accn),
      ...(latest.val !== original.val ? { restatedValue: latest.val } : {}),
    };
  }
  return null;
}

/** Only the most recent fiscal years are supported: these are the ones checked against the 10-Ks. */
const SUPPORTED_YEARS = 3;

/**
 * Supported fiscal years, keyed by the company's own label (e.g. "FY2025") -> period end date.
 * The label is the fiscal year stated by the original filing, so Nvidia's year ending Jan 2026 is "FY2026".
 */
export function availablePeriods(data: Record<string, Row[]>): Record<string, string> {
  const originals = new Map<string, Row>();
  for (const concept of CONCEPTS.revenue)
    for (const r of data[concept] ?? []) {
      const seen = originals.get(r.end);
      if (!seen || r.filed < seen.filed) originals.set(r.end, r);
    }
  const out: Record<string, string> = {};
  for (const end of [...originals.keys()].sort().slice(-SUPPORTED_YEARS)) out[`FY${originals.get(end)!.fy}`] = end;
  return out;
}
