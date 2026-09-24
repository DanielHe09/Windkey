// Shared by the snapshot script and the live loader: reduce SEC company facts to annual 10-K rows.

/** XBRL tags tried for each metric, in order of preference. cost_of_revenue is only used to cross-check figures. */
export const CONCEPTS_BY_METRIC = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"],
  operating_income: ["OperatingIncomeLoss"],
  net_income: ["NetIncomeLoss"],
  gross_profit: ["GrossProfit"],
  cost_of_revenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
};

const CONCEPTS = Object.values(CONCEPTS_BY_METRIC).flat();

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/**
 * @param {any} raw response of data.sec.gov/api/xbrl/companyfacts
 * @returns {Record<string, { start: string, end: string, val: number, accn: string, filed: string, fy: number }[]>}
 */
export function trimCompanyFacts(raw) {
  const facts = {};
  for (const concept of CONCEPTS) {
    const rows = raw.facts?.["us-gaap"]?.[concept]?.units?.USD ?? [];
    const annual = rows
      .filter((r) => r.form === "10-K" && r.fp === "FY" && r.start && days(r.start, r.end) > 350 && days(r.start, r.end) < 380)
      .map(({ start, end, val, accn, filed, fy }) => ({ start, end, val, accn, filed, fy }));
    if (annual.length) facts[concept] = annual;
  }
  return facts;
}
