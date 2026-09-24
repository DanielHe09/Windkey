import { describe, expect, it } from "vitest";
import { getFact, availablePeriods, filingUrl, type Metric } from "@/lib/sec";
import { verify, type Claim } from "@/lib/verify";

const periods = availablePeriods();
const base: Claim = {
  raw_text: "",
  metric: "revenue",
  kind: "pct_change",
  direction: null,
  value: null,
  period: "FY2025",
  compare_to: "FY2024",
  unsupported_reason: null,
};
const run = (c: Partial<Claim>) => verify({ ...base, ...c }, periods);

// Income statement figures ($M) read directly from the "Consolidated Statements of Operations" (R3.htm)
// in Apple's FY2025 (0000320193-25-000079), FY2024 (0000320193-24-000123) and FY2023 (0000320193-23-000106) 10-Ks.
const FROM_10K: Record<string, Record<string, number>> = {
  "2025-09-27": { revenue: 416161, gross_profit: 195201, operating_income: 133050, net_income: 112010 },
  "2024-09-28": { revenue: 391035, gross_profit: 180683, operating_income: 123216, net_income: 93736 },
  "2023-09-30": { revenue: 383285, gross_profit: 169148, operating_income: 114301, net_income: 96995 },
};

describe("snapshot matches the filed 10-K income statements", () => {
  for (const [end, metrics] of Object.entries(FROM_10K))
    for (const [metric, millions] of Object.entries(metrics))
      it(`${metric} ${end}`, () => expect(getFact(metric as Metric, end)!.value).toBe(millions * 1e6));
});

describe("fact selection", () => {
  it("FY2024 revenue is $391.035B from the FY2024 10-K", () => {
    const f = getFact("revenue", "2024-09-28")!;
    expect(f.value).toBe(391_035_000_000);
    expect(f.accn).toBe("0000320193-24-000123");
    expect(f.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm");
  });
  it("matches by period end, citing the original filing not later comparatives", () => {
    expect(getFact("operating_income", "2023-09-30")!.accn).toBe("0000320193-23-000106");
  });
  it("returns null for periods without data", () => {
    expect(getFact("revenue", "2001-09-29")).toBeNull();
  });
  it("exposes FY2023-FY2025", () => {
    expect(Object.keys(periods)).toEqual(expect.arrayContaining(["FY2023", "FY2024", "FY2025"]));
  });
  it("filingUrl strips leading zeros in CIK and dashes in accession", () => {
    expect(filingUrl("0000320193", "0000320193-24-000123")).toContain("/data/320193/000032019324000123/");
  });
});

describe("verify", () => {
  // FY2025 416.161 vs FY2024 391.035 => +6.4257%
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
