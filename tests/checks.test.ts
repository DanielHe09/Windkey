import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/checks";
import type { Fact, Metric } from "@/lib/sec";

type Values = Partial<Record<Metric, number>>;
const B = 1e9;

function factsFor(byEnd: Record<string, Values>, revenueTag = "Revenues") {
  return (metric: Metric, end: string): Fact | null => {
    const value = byEnd[end]?.[metric];
    if (value === undefined) return null;
    const concept = metric === "revenue" ? revenueTag : metric;
    return { metric, concept, periodEnd: end, periodStart: "", value, accn: "0-0-0", filed: "2025-01-01", url: "https://www.sec.gov/" };
  };
}

const good = {
  "2024-12-31": { revenue: 100 * B, cost_of_revenue: 60 * B, gross_profit: 40 * B, operating_income: 20 * B },
  "2023-12-31": { revenue: 90 * B, cost_of_revenue: 55 * B, gross_profit: 35 * B, operating_income: 15 * B },
};
const ends = ["2024-12-31", "2023-12-31"];

describe("runChecks", () => {
  it("passes and cross-checks consistent figures", () => {
    const r = runChecks(ends, factsFor(good));
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.crossChecked).toBe(true);
  });
  it("fails when revenue does not reconcile to gross profit (wrong tag or segment figure)", () => {
    const bad = { ...good, "2024-12-31": { ...good["2024-12-31"], revenue: 70 * B } };
    const r = runChecks(ends, factsFor(bad));
    expect(r.checks.find((c) => c.name.startsWith("Revenue − cost"))!.ok).toBe(false);
    expect(r.crossChecked).toBe(false);
  });
  it("fails when operating income exceeds revenue", () => {
    const bad = { ...good, "2024-12-31": { ...good["2024-12-31"], operating_income: 150 * B } };
    expect(runChecks(ends, factsFor(bad)).checks.some((c) => !c.ok)).toBe(true);
  });
  it("fails when the two periods are not consecutive fiscal years", () => {
    const r = runChecks(["2024-12-31", "2022-12-31"], factsFor({ "2024-12-31": good["2024-12-31"], "2022-12-31": good["2023-12-31"] }));
    expect(r.checks.find((c) => c.name.startsWith("Periods are consecutive"))!.ok).toBe(false);
  });
  it("accepts 52/53-week fiscal years (371 days apart)", () => {
    const r = runChecks(["2024-02-03", "2023-01-28"], factsFor({ "2024-02-03": good["2024-12-31"], "2023-01-28": good["2023-12-31"] }));
    expect(r.checks.find((c) => c.name.startsWith("Periods are consecutive"))!.ok).toBe(true);
  });
  it("fails when the revenue tag changes between periods", () => {
    const f = factsFor(good);
    const mixed = (m: Metric, e: string) => {
      const x = f(m, e);
      return x && m === "revenue" && e === "2023-12-31" ? { ...x, concept: "SalesRevenueNet" } : x;
    };
    expect(runChecks(ends, mixed).checks.find((c) => c.name.startsWith("Same revenue tag"))!.ok).toBe(false);
  });
  it("does not cross-check when cost of revenue or gross profit is missing", () => {
    const noCost = Object.fromEntries(Object.entries(good).map(([k, v]) => [k, { revenue: v.revenue, operating_income: v.operating_income }]));
    const r = runChecks(ends, factsFor(noCost));
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.crossChecked).toBe(false);
  });
});
