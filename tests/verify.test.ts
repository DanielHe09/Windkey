import { describe, expect, it } from "vitest";
import { availablePeriods, filingUrl, getFact, type Metric } from "@/lib/sec";
import { SNAPSHOTS } from "@/lib/snapshots";
import { runChecks } from "@/lib/checks";
import { companiesNamed, depsFor, verify, type Claim } from "@/lib/verify";

// Income statement figures ($M) read directly from each "Consolidated Statements of Operations/Income Statements"
// (R2/R3.htm) in the companies' 10-Ks (Apple FY2023-25, Microsoft FY2024-26, Nvidia FY2024-26).
const FROM_10K: Record<string, Record<string, Record<Exclude<Metric, "cost_of_revenue">, number>>> = {
  AAPL: {
    "2025-09-27": { revenue: 416161, gross_profit: 195201, operating_income: 133050, net_income: 112010 },
    "2024-09-28": { revenue: 391035, gross_profit: 180683, operating_income: 123216, net_income: 93736 },
    "2023-09-30": { revenue: 383285, gross_profit: 169148, operating_income: 114301, net_income: 96995 },
  },
  MSFT: {
    "2026-06-30": { revenue: 331839, gross_profit: 225465, operating_income: 155237, net_income: 133749 },
    "2025-06-30": { revenue: 281724, gross_profit: 193893, operating_income: 128528, net_income: 101832 },
    "2024-06-30": { revenue: 245122, gross_profit: 171008, operating_income: 109433, net_income: 88136 },
  },
  NVDA: {
    "2026-01-25": { revenue: 215938, gross_profit: 153463, operating_income: 130387, net_income: 120067 },
    "2025-01-26": { revenue: 130497, gross_profit: 97858, operating_income: 81453, net_income: 72880 },
    "2024-01-28": { revenue: 60922, gross_profit: 44301, operating_income: 32972, net_income: 29760 },
  },
};

const snap = (t: string) => SNAPSHOTS[t];
const depsOf = (t: string) => depsFor(snap(t).facts, snap(t).cik, true);

describe("snapshots match the filed 10-K income statements", () => {
  for (const [ticker, years] of Object.entries(FROM_10K))
    for (const [end, metrics] of Object.entries(years))
      for (const [metric, millions] of Object.entries(metrics))
        it(`${ticker} ${metric} ${end}`, () => expect(getFact(metric as Metric, end, snap(ticker).facts, snap(ticker).cik)!.value).toBe(millions * 1e6));
});

describe("fiscal-year labels use each company's own naming", () => {
  it("Apple: FY2023-FY2025 (Sept year-end)", () => expect(Object.keys(availablePeriods(snap("AAPL").facts))).toEqual(["FY2023", "FY2024", "FY2025"]));
  it("Microsoft: FY2024-FY2026 (June year-end)", () => expect(availablePeriods(snap("MSFT").facts)).toEqual({ FY2024: "2024-06-30", FY2025: "2025-06-30", FY2026: "2026-06-30" }));
  it("Nvidia: the year ending Jan 2026 is FY2026", () => expect(availablePeriods(snap("NVDA").facts)).toEqual({ FY2024: "2024-01-28", FY2025: "2025-01-26", FY2026: "2026-01-25" }));
});

describe("fact selection", () => {
  it("cites the original filing, not later comparatives", () => {
    const f = getFact("revenue", "2024-09-28", snap("AAPL").facts, snap("AAPL").cik)!;
    expect(f.accn).toBe("0000320193-24-000123");
    expect(f.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm");
    expect(getFact("operating_income", "2023-09-30", snap("AAPL").facts, snap("AAPL").cik)!.accn).toBe("0000320193-23-000106");
  });
  it("returns null for periods without data", () => expect(getFact("revenue", "2001-09-29", snap("AAPL").facts, snap("AAPL").cik)).toBeNull());
  it("filingUrl strips leading zeros in CIK and dashes in accession", () => {
    expect(filingUrl("0000320193", "0000320193-24-000123")).toContain("/data/320193/000032019324000123/");
  });
});

const base: Claim = {
  raw_text: "",
  company: "AAPL",
  compares_companies: false,
  metric: "revenue",
  kind: "pct_change",
  direction: null,
  value: null,
  period: "FY2025",
  compare_to: "FY2024",
  unsupported_reason: null,
};
const run = (c: Partial<Claim>, ticker = "AAPL") => verify({ ...base, company: ticker, ...c }, depsOf(ticker));

describe("verify (Apple FY2025 vs FY2024: revenue +6.4257%)", () => {
  it("supports a correct percent change", () => expect(run({ value: 6.4 }).verdict).toBe("SUPPORTED"));
  it("supports at stated precision (6%)", () => expect(run({ value: 6 }).verdict).toBe("SUPPORTED"));
  it("rejects a wrong percent change", () => expect(run({ value: 18 }).verdict).toBe("INCORRECT"));
  it("rejects just outside rounding tolerance", () => expect(run({ value: 6.5 }).verdict).toBe("INCORRECT"));
  it("treats 'fell 6%' as incorrect when revenue rose", () => expect(run({ value: 6, direction: "down" }).verdict).toBe("INCORRECT"));
  it("supports a correct direction", () => expect(run({ kind: "direction", direction: "up" }).verdict).toBe("SUPPORTED"));
  it("rejects a wrong direction", () => expect(run({ kind: "direction", direction: "down" }).verdict).toBe("INCORRECT"));
  it("checks operating margin direction (31.5% -> 32.0%: rose)", () => {
    expect(run({ metric: "operating_margin", kind: "direction", direction: "up" }).verdict).toBe("SUPPORTED");
    expect(run({ metric: "operating_margin", kind: "direction", direction: "down" }).verdict).toBe("INCORRECT");
  });
  it("checks a level claim in $B", () => {
    expect(run({ kind: "level", value: 391.0, period: "FY2024", compare_to: null }).verdict).toBe("SUPPORTED");
    expect(run({ kind: "level", value: 400, period: "FY2024", compare_to: null }).verdict).toBe("INCORRECT");
  });
  it("cannot verify unsupported metrics / non-claims", () => {
    expect(run({ metric: null, kind: null, unsupported_reason: "EPS not supported" }).verdict).toBe("CANNOT_VERIFY");
  });
  it("cannot verify periods outside the data", () => {
    expect(run({ period: "FY2010", compare_to: "FY2009", value: 5 }).verdict).toBe("CANNOT_VERIFY");
  });
  it("always attaches evidence with filing links and arithmetic", () => {
    const r = run({ value: 18 });
    expect(r.evidence.length).toBe(2);
    expect(r.evidence.every((e) => e.url.startsWith("https://www.sec.gov/"))).toBe(true);
    expect(r.arithmetic).toContain("+6.43%");
  });
});

describe("verify across companies", () => {
  it("Microsoft operating margin rose (45.62% -> 46.78%), so 'fell' is incorrect", () => {
    const r = run({ metric: "operating_margin", kind: "direction", direction: "down", period: null, compare_to: null }, "MSFT");
    expect(r.verdict).toBe("INCORRECT");
    expect(r.evidence.every((e) => e.url.includes("/data/789019/"))).toBe(true);
  });
  it("Nvidia FY2026 revenue growth is +65.47%: 65% supported, 66% incorrect", () => {
    expect(run({ value: 65, period: "FY2026", compare_to: "FY2025" }, "NVDA").verdict).toBe("SUPPORTED");
    expect(run({ value: 66, period: "FY2026", compare_to: "FY2025" }, "NVDA").verdict).toBe("INCORRECT");
  });
  it("Nvidia's FY label is not accepted for Apple's data", () => expect(run({ period: "FY2026", compare_to: "FY2025", value: 5 }, "AAPL").verdict).toBe("CANNOT_VERIFY"));
  it("refuses when the parse says the sentence compares companies or a benchmark", () => {
    const r = run({ compares_companies: true, metric: null, kind: null });
    expect(r.verdict).toBe("CANNOT_VERIFY");
    expect(r.reason).toMatch(/compares/i);
  });
  it("refuses a claim that names several companies, even if the parse picked one", () => {
    const r = run({ raw_text: "Nvidia's revenue rose faster than Microsoft's.", kind: "direction", direction: "up" }, "NVDA");
    expect(r.verdict).toBe("CANNOT_VERIFY");
    expect(r.reason).toMatch(/compares several companies/i);
  });
  it("companiesNamed matches short names and tickers only as whole words", () => {
    expect(companiesNamed("Apple and MSFT")).toEqual(["AAPL", "MSFT"]);
    expect(companiesNamed("pineapple sales rose")).toEqual([]);
  });
});

describe("trust levels and data checks", () => {
  it("hand-verified companies are marked verified and pass every check", () => {
    for (const t of ["AAPL", "MSFT", "NVDA"]) {
      const r = run({ value: 1, period: null, compare_to: null }, t);
      expect(r.trust).toBe("verified");
      expect(r.checks.length).toBeGreaterThan(0);
      expect(r.checks.every((k) => k.ok)).toBe(true);
    }
  });
  it("revenue reconciles to gross profit for all three companies in every supported period", () => {
    for (const t of ["AAPL", "MSFT", "NVDA"]) {
      const d = depsOf(t);
      const r = runChecks(Object.values(d.periods), d.fact);
      expect(r.crossChecked).toBe(true);
    }
  });
});

describe("companies that are not hand-verified", () => {
  const cik = snap("AAPL").cik;
  const withoutCost = Object.fromEntries(Object.entries(snap("AAPL").facts).filter(([k]) => !k.startsWith("CostOf")));
  const scaled = { ...snap("AAPL").facts, RevenueFromContractWithCustomerExcludingAssessedTax: snap("AAPL").facts.RevenueFromContractWithCustomerExcludingAssessedTax.map((r) => (r.end === "2025-09-27" ? { ...r, val: r.val * 0.5 } : r)) };
  const claim = { ...base, value: 6.4 };

  it("labels a revenue claim cross-checked when revenue reconciles to gross profit", () => {
    const r = verify(claim, depsFor(snap("AAPL").facts, cik, false));
    expect(r.verdict).toBe("SUPPORTED");
    expect(r.trust).toBe("cross-checked");
  });
  it("still gives a verdict but labels it unchecked when there is nothing to reconcile against", () => {
    const r = verify(claim, depsFor(withoutCost, cik, false));
    expect(r.verdict).toBe("SUPPORTED");
    expect(r.trust).toBe("unchecked");
  });
  it("labels operating income unchecked (no independent cross-check exists)", () => {
    expect(verify({ ...claim, metric: "operating_income", value: 8 }, depsFor(snap("AAPL").facts, cik, false)).trust).toBe("unchecked");
  });
  it("refuses instead of guessing when the figures fail a data check (wrong revenue figure)", () => {
    const r = verify(claim, depsFor(scaled, cik, false));
    expect(r.verdict).toBe("CANNOT_VERIFY");
    expect(r.reason).toMatch(/Data check failed/);
    expect(r.checks.some((k) => !k.ok)).toBe(true);
  });
});
