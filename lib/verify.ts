import { z } from "zod";
import { COMPANIES } from "./companies.mjs";
import { runChecks, type Check } from "./checks";
import { availablePeriods, getFact, METRIC_LABEL, usd, type Fact, type Metric, type Row } from "./sec";

export const ClaimSchema = z.object({
  raw_text: z.string(),
  /** the company the claim is about, as named in the note (name or ticker); null when the note names none */
  company: z.string().nullable(),
  /** true when the sentence involves more than one company, or compares against a benchmark or peers */
  compares_companies: z.boolean(),
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
  /** verified: company hand-checked against its 10-Ks; cross-checked: revenue identity passed; unchecked: sanity checks only */
  trust: "verified" | "cross-checked" | "unchecked" | null;
  checks: Check[];
}

const pct = (n: number) => `${n.toFixed(2)}%`;

/** Period end dates keyed by label; injectable for tests. */
export type Periods = Record<string, string>;

export interface Deps {
  /** True for companies whose figures were checked by hand against their 10-Ks. */
  verified: boolean;
  periods: Periods;
  fact: (metric: Metric, end: string) => Fact | null;
}

/** Lookup functions for one company's SEC data. */
export const depsFor = (data: Record<string, Row[]>, cik: string, verified: boolean): Deps => ({
  verified,
  periods: availablePeriods(data),
  fact: (metric, end) => getFact(metric, end, data, cik),
});

export const refuse = (claim: Claim, reason: string, evidence: Evidence[] = [], checks: Check[] = []): Result => ({
  claim,
  verdict: "CANNOT_VERIFY",
  arithmetic: "",
  reason,
  evidence,
  trust: null,
  checks,
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

/** Supported companies named in a piece of text (by short name or ticker). */
export function companiesNamed(text: string): string[] {
  return COMPANIES.filter((c) => new RegExp(`\\b(${c.name.split(" ")[0]}|${c.ticker})\\b`, "i").test(text)).map((c) => c.ticker);
}

/** Refusals that need no company data: not a checkable claim, or a claim about several companies. */
export function screen(claim: Claim): Result | null {
  // A sentence comparing companies cannot be reduced to one company's figure; never let a parse pick one.
  if (claim.compares_companies || companiesNamed(claim.raw_text).length > 1)
    return refuse(claim, "This compares several companies or a benchmark; only single-company claims are checked.");
  if (!claim.metric || !claim.kind) return refuse(claim, claim.unsupported_reason ?? "Not a numerical claim about a supported metric.");
  return null;
}

export function verify(claim: Claim, deps: Deps): Result {
  const screened = screen(claim);
  if (screened) return screened;
  const metric = claim.metric!;

  const labels = Object.keys(deps.periods).sort();
  if (!labels.length) return refuse(claim, "No annual revenue figures were found for this company in its SEC 10-K data.");
  const cur = claim.period ?? labels[labels.length - 1];
  const prior = claim.compare_to ?? (claim.kind === "level" ? null : labels[labels.indexOf(cur) - 1] ?? null);
  if (!(cur in deps.periods)) return refuse(claim, `No filing data for ${cur}. Available: ${labels.join(", ")}.`);
  if (prior && !(prior in deps.periods)) return refuse(claim, `No filing data for ${prior}. Available: ${labels.join(", ")}.`);
  if (claim.kind !== "level" && !prior) return refuse(claim, `No earlier period available to compare ${cur} against.`);

  const c = measure(metric, deps.periods[cur], cur, deps);
  const p = prior ? measure(metric, deps.periods[prior], prior, deps) : null;
  if (!c || (prior && !p)) return refuse(claim, "Required figures were not found in the filing data.");
  const evidence = [...c.evidence, ...(p?.evidence ?? [])];

  // Automatic data checks: refuse rather than trust figures that look wrong.
  const report = runChecks([deps.periods[cur], ...(prior ? [deps.periods[prior]] : [])], deps.fact);
  const failed = report.checks.find((k) => !k.ok);
  if (failed) return refuse(claim, `Data check failed: ${failed.name} (${failed.detail}). The SEC figures for this company look unreliable.`, evidence, report.checks);
  // Revenue-based figures that reconcile to gross profit are "cross-checked"; without that data the verdict is labelled unchecked.
  const revenueDriven = metric === "revenue" || metric === "gross_profit" || metric === "gross_margin";
  const trust: Result["trust"] = deps.verified ? "verified" : revenueDriven && report.crossChecked ? "cross-checked" : "unchecked";
  const fmt = (n: number, ratio: boolean) => (ratio ? pct(n) : usd(n));

  if (claim.kind === "level") {
    if (claim.value === null) return refuse(claim, "No amount stated to check.", evidence);
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
      trust,
      checks: report.checks,
    };
  }

  const change = c.isRatio ? c.value - p!.value : ((c.value - p!.value) / Math.abs(p!.value)) * 100;
  const changeStr = c.isRatio
    ? `${pct(c.value)} − ${pct(p!.value)} = ${change >= 0 ? "+" : ""}${change.toFixed(2)} percentage points`
    : `(${usd(c.value)} − ${usd(p!.value)}) / ${usd(Math.abs(p!.value))} = ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  const EPS = 1e-9;
  const actualDir = change > EPS ? "up" : change < -EPS ? "down" : "flat";

  if (claim.kind === "direction") {
    if (!claim.direction) return refuse(claim, "No direction of change stated.", evidence);
    return {
      claim,
      verdict: actualDir === claim.direction ? "SUPPORTED" : "INCORRECT",
      arithmetic: `${changeStr} → ${actualDir === "up" ? "rose" : actualDir === "down" ? "fell" : "unchanged"} (claimed: ${claim.direction === "up" ? "rose" : "fell"})`,
      evidence,
      trust,
      checks: report.checks,
    };
  }

  // pct_change: signed claim; direction wins if the sentence gave one
  if (claim.value === null) return refuse(claim, "No percentage stated to check.", evidence);
  if (c.isRatio) return refuse(claim, "Margin changes are checked in percentage points; the claim should be a direction or a level.", evidence);
  const signed = claim.direction === "down" ? -Math.abs(claim.value) : claim.value;
  const decimals = (String(Math.abs(claim.value)).split(".")[1] ?? "").length;
  const tol = 0.5 * 10 ** -decimals;
  const ok = Math.abs(change - signed) <= tol + 1e-9;
  return {
    claim,
    verdict: ok ? "SUPPORTED" : "INCORRECT",
    arithmetic: `${changeStr} vs ${signed > 0 ? "+" : ""}${signed}% claimed (tolerance ±${tol}pp, from stated precision)`,
    evidence,
    trust,
    checks: report.checks,
  };
}
