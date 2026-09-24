import { usd, type Fact, type Metric } from "./sec";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CheckReport {
  checks: Check[];
  /** True when revenue was independently cross-checked (revenue − cost of revenue = gross profit) in every period. */
  crossChecked: boolean;
}

type FactFn = (metric: Metric, end: string) => Fact | null;

const days = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 864e5;

/**
 * Automatic sanity checks on the figures pulled from SEC tags. Any failed check means the figures cannot be trusted
 * (wrong tag, segment total, odd fiscal calendar), so the caller must refuse a verdict rather than guess.
 */
export function runChecks(ends: string[], fact: FactFn): CheckReport {
  const checks: Check[] = [];
  let identityPassed = 0;

  if (ends.length === 2) {
    const gap = days(ends[0], ends[1]);
    checks.push({ name: "Periods are consecutive fiscal years", ok: gap > 350 && gap < 380, detail: `${Math.round(gap)} days apart` });
  }

  const revenueTags = new Set<string>();
  for (const end of ends) {
    const rev = fact("revenue", end);
    if (!rev) continue;
    revenueTags.add(rev.concept);
    checks.push({ name: `Revenue is positive (${end})`, ok: rev.value > 0, detail: usd(rev.value) });

    const gp = fact("gross_profit", end);
    const cost = fact("cost_of_revenue", end);
    if (gp && cost) {
      const diff = Math.abs(rev.value - cost.value - gp.value);
      const ok = diff <= 0.005 * rev.value;
      if (ok) identityPassed++;
      checks.push({
        name: `Revenue − cost of revenue = gross profit (${end})`,
        ok,
        detail: `${usd(rev.value)} − ${usd(cost.value)} = ${usd(rev.value - cost.value)} vs reported ${usd(gp.value)}`,
      });
    }
    if (gp) checks.push({ name: `Gross profit ≤ revenue (${end})`, ok: gp.value <= rev.value, detail: `${usd(gp.value)} vs ${usd(rev.value)}` });
    const oi = fact("operating_income", end);
    if (oi) checks.push({ name: `Operating income ≤ revenue (${end})`, ok: oi.value <= rev.value, detail: `${usd(oi.value)} vs ${usd(rev.value)}` });
  }
  if (revenueTags.size > 0)
    checks.push({ name: "Same revenue tag in every period", ok: revenueTags.size === 1, detail: [...revenueTags].join(", ") });

  return { checks, crossChecked: ends.length > 0 && identityPassed === ends.length };
}
