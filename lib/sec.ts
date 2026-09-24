import snapshot from "@/data/aapl-facts.json";

export type Metric = "revenue" | "operating_income" | "net_income" | "gross_profit";

export const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  net_income: "Net income",
  gross_profit: "Gross profit",
};

const CONCEPTS: Record<Metric, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  operating_income: ["OperatingIncomeLoss"],
  net_income: ["NetIncomeLoss"],
  gross_profit: ["GrossProfit"],
};

interface Row {
  start: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
}

export interface Fact {
  metric: Metric;
  periodEnd: string;
  periodStart: string;
  value: number;
  accn: string;
  filed: string;
  url: string;
  /** Set when a later filing reports a different value for the same period. */
  restatedValue?: number;
}

export const COMPANY = {
  ticker: snapshot.ticker,
  name: snapshot.entityName,
  cik: snapshot.cik,
};

const rows = snapshot.facts as Record<string, Row[]>;

export function filingUrl(cik: string, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll("-", "")}/${accn}-index.htm`;
}

/**
 * Annual value for a metric, matched by period END date (not the `fy` field, which
 * labels the filing, not the period). The same period is repeated as a comparative
 * in later 10-Ks; we cite the original filing and flag any later restatement.
 */
export function getFact(metric: Metric, periodEnd: string, data: Record<string, Row[]> = rows, cik = COMPANY.cik): Fact | null {
  for (const concept of CONCEPTS[metric]) {
    const matches = (data[concept] ?? []).filter((r) => r.end === periodEnd).sort((a, b) => a.filed.localeCompare(b.filed));
    if (!matches.length) continue;
    const original = matches[0];
    const latest = matches[matches.length - 1];
    return {
      metric,
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

/** Only the most recent fiscal years are supported: these are the ones hand-checked against the 10-Ks. */
const SUPPORTED_YEARS = 3;

/** Supported fiscal years, keyed by label (e.g. "FY2024") -> period end date. */
export function availablePeriods(data: Record<string, Row[]> = rows): Record<string, string> {
  const ends = new Set<string>();
  for (const concept of CONCEPTS.revenue) for (const r of data[concept] ?? []) ends.add(r.end);
  const out: Record<string, string> = {};
  // Apple's fiscal year ends in late Sept; label by the calendar year of the end date.
  for (const end of [...ends].sort().slice(-SUPPORTED_YEARS)) out[`FY${end.slice(0, 4)}`] = end;
  return out;
}
