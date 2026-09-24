import { getFact, METRIC_LABEL, type Fact, type Metric } from "./sec";
import { z } from "zod";

export const ClaimSchema = z.object({
  raw_text: z.string(),
  /** null when the sentence is not a checkable claim about a supported metric */
  metric: z.enum(["revenue", "operating_income", "net_income", "gross_profit", "operating_margin", "gross_margin"]).nullable(),
  kind: z.enum(["pct_change", "direction", "level"]).nullable(),
  direction: z.enum(["up", "down"]).nullable(),
  /** pct_change: percent (18 means 18%); level: amount in USD billions (or percent for margins) */
  value: z.number().nullable(),
  /** fiscal years as "FY2024"; null means "latest vs prior" */
  period: z.string().nullable(),
  compare_to: z.string().nullable(),
  unsupported_reason: z.string().nullable(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export type Verdict = "SUPPORTED" | "INCORRECT" | "CANNOT_VERIFY";

export interface Evidence {
  label: string;
  value: string;
  url: string;
}

export interface Result {
  claim: Claim;
  verdict: Verdict;
  arithmetic: string;
  reason?: string;
  evidence: Evidence[];
}

export const usd = (n: number) => `$${(n / 1e9).toFixed(3).replace(/\.?0+$/, "")}B`;
const pct = (n: number) => `${n.toFixed(2)}%`;

/** Period end dates keyed by label; injectable for tests. */
export type Periods = Record<string, string>;

interface Deps {
  periods: Periods;
  fact: (metric: Metric, end: string) => Fact | null;
}

const defaultDeps = (periods: Periods): Deps => ({ periods, fact: (m, e) => getFact(m, e) });

const cannot = (claim: Claim, reason: string, evidence: Evidence[] = []): Result => ({
  claim,
  verdict: "CANNOT_VERIFY",
  arithmetic: "",
  reason,
  evidence,
});

/** Value of a metric (or margin) for one period, with the facts it came from. */
function measure(metric: NonNullable<Claim["metric"]>, end: string, label: string, deps: Deps) {
  const base = metric === "operating_margin" ? "operating_income" : metric === "gross_margin" ? "gross_profit" : metric;
  const nums: Fact[] = [];
  const top = deps.fact(base as Metric, end);
  if (!top) return null;
  nums.push(top);
  let value = top.value;
  let isRatio = false;
  if (metric === "operating_margin" || metric === "gross_margin") {
    const rev = deps.fact("revenue", end);
    if (!rev) return null;
    nums.push(rev);
    value = (top.value / rev.value) * 100;
    isRatio = true;
  }
  const evidence: Evidence[] = nums.map((f) => ({
    label: `${METRIC_LABEL[f.metric]} ${label} (period ending ${f.periodEnd}, 10-K filed ${f.filed})`,
    value: usd(f.value) + (f.restatedValue !== undefined ? ` (restated later to ${usd(f.restatedValue)})` : ""),
    url: f.url,
  }));
  return { value, isRatio, evidence, nums };
}

export function verify(claim: Claim, periods: Periods, deps: Deps = defaultDeps(periods)): Result {
  if (!claim.metric || !claim.kind) return cannot(claim, claim.unsupported_reason ?? "Not a numerical claim about a supported metric.");

  const labels = Object.keys(deps.periods).sort();
  const cur = claim.period ?? labels[labels.length - 1];
  const prior = claim.compare_to ?? (claim.kind === "level" ? null : labels[labels.indexOf(cur) - 1] ?? null);
  if (!(cur in deps.periods)) return cannot(claim, `No filing data for ${cur}. Available: ${labels.join(", ")}.`);
  if (prior && !(prior in deps.periods)) return cannot(claim, `No filing data for ${prior}. Available: ${labels.join(", ")}.`);
  if (claim.kind !== "level" && !prior) return cannot(claim, `No earlier period available to compare ${cur} against.`);

  const c = measure(claim.metric, deps.periods[cur], cur, deps);
  const p = prior ? measure(claim.metric, deps.periods[prior], prior, deps) : null;
  if (!c || (prior && !p)) return cannot(claim, "Required figures were not found in the filing data.");
  const evidence = [...c.evidence, ...(p?.evidence ?? [])];
  const fmt = (n: number, ratio: boolean) => (ratio ? pct(n) : usd(n));

  if (claim.kind === "level") {
    if (claim.value === null) return cannot(claim, "No amount stated to check.", evidence);
    // Claimed value: USD billions for dollar metrics, percent for margins.
    const actual = c.isRatio ? c.value : c.value / 1e9;
    const decimals = (String(claim.value).split(".")[1] ?? "").length;
    const tol = 0.5 * 10 ** -decimals;
    const ok = Math.abs(actual - claim.value) <= tol + 1e-9;
    return {
      claim,
      verdict: ok ? "SUPPORTED" : "INCORRECT",
      arithmetic: `${fmt(c.value, c.isRatio)} actual vs ${claim.value}${c.isRatio ? "%" : "B"} claimed (tolerance ±${tol}, from stated precision)`,
      evidence,
    };
  }

  const change = c.isRatio ? c.value - p!.value : ((c.value - p!.value) / Math.abs(p!.value)) * 100;
  const changeStr = c.isRatio
    ? `${pct(c.value)} − ${pct(p!.value)} = ${change >= 0 ? "+" : ""}${change.toFixed(2)} percentage points`
    : `(${usd(c.value)} − ${usd(p!.value)}) / ${usd(Math.abs(p!.value))} = ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  const EPS = 1e-9;
  const actualDir = change > EPS ? "up" : change < -EPS ? "down" : "flat";

  if (claim.kind === "direction") {
    if (!claim.direction) return cannot(claim, "No direction of change stated.", evidence);
    return {
      claim,
      verdict: actualDir === claim.direction ? "SUPPORTED" : "INCORRECT",
      arithmetic: `${changeStr} → ${actualDir === "up" ? "rose" : actualDir === "down" ? "fell" : "unchanged"} (claimed: ${claim.direction === "up" ? "rose" : "fell"})`,
      evidence,
    };
  }

  // pct_change: signed claim; direction wins if the sentence gave one
  if (claim.value === null) return cannot(claim, "No percentage stated to check.", evidence);
  if (c.isRatio) return cannot(claim, "Margin changes are checked in percentage points; the claim should be a direction or a level.", evidence);
  const signed = claim.direction === "down" ? -Math.abs(claim.value) : claim.value;
  const decimals = (String(Math.abs(claim.value)).split(".")[1] ?? "").length;
  const tol = 0.5 * 10 ** -decimals;
  const ok = Math.abs(change - signed) <= tol + 1e-9;
  return {
    claim,
    verdict: ok ? "SUPPORTED" : "INCORRECT",
    arithmetic: `${changeStr} vs ${signed > 0 ? "+" : ""}${signed}% claimed (tolerance ±${tol}pp, from stated precision)`,
    evidence,
  };
}
