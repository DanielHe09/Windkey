# Earnings claim checker

Paste 1–3 numerical claims from a draft earnings note about any US-listed company. Each claim is checked against SEC 10-K XBRL data and returns **Supported / Incorrect / Cannot verify**, with the arithmetic, both source figures, and a link to the filing.

## Design: the language model parses, code decides
1. `lib/extract.ts`: the model turns each sentence into a structured claim (metric, kind, direction, stated value, period). It never sees SEC data and never outputs a verdict.
2. `lib/sec.ts` + `lib/sec-live.ts`: figures come from SEC XBRL company facts, fetched live and cached 24h, with a bundled snapshot (`scripts/build-snapshot.mjs`) as fallback if the SEC is unreachable. Periods are matched by fiscal period **end date**; the original filing is cited, and later restatements are flagged.
3. `lib/verify.ts`: pure functions compute the change and compare it with the claim at the claim's own stated precision ("6%" tolerates ±0.5pp; "6.4%" tolerates ±0.05pp). Anything unsupported returns "Cannot verify".

## What the language model does vs. what code does
The model (`gpt-4o-mini`, `lib/extract.ts`) does exactly one thing, and does it the same way for every company: it reads the note and fills in a structured claim (company as written, metric, direction, stated number, fiscal years, and a flag if the sentence compares companies). It never sees SEC data, does no arithmetic, and produces no verdict. Its output is validated against a strict schema and shown to the user as "Parsed as".

Everything after that is deterministic code:

| Step | Apple, Microsoft, Nvidia (verified) | Any other company |
|---|---|---|
| 1. Parse the sentence | Language model | Language model |
| 2. Refuse non-claims and comparisons (`screen` in `lib/verify.ts`) | Code: no metric/kind, the model's comparison flag, or more than one of Apple/Microsoft/Nvidia named in the text | Same (the name check only recognizes those three, so for other companies a comparison is caught by the model's flag) |
| 3. Identify the company (`lib/resolve.ts`) | Code: matched directly against the hand-verified list | Code: matched against the SEC ticker list by ticker, exact name, or unique name prefix; ambiguous or unknown names are refused |
| 4. Get the figures (`lib/sec-live.ts`) | SEC XBRL company facts, live (cached 24h). If the SEC is unreachable, falls back to a bundled snapshot of the same data | SEC XBRL company facts, live (cached 24h). No fallback: if the SEC is unreachable the claim is refused |
| 5. Select the facts (`lib/sec.ts`) | Code: match by fiscal period end date, cite the original 10-K, flag later restatements, label years as the company does | Same |
| 6. Data checks (`lib/checks.ts`) | Code: consecutive periods, positive revenue, same revenue tag every period, gross profit and operating income ≤ revenue, revenue − cost of revenue = gross profit. Any failure refuses the claim | Same checks; any failure refuses the claim |
| 7. Compute and decide (`lib/verify.ts`) | Code: percent change or margin calculation, compared with the claim at its stated precision | Same |
| Independent proof of the figures | Every figure is pinned in `tests/verify.test.ts` to the income statements in the company's own 10-Ks | None beyond step 6 |
| Badge on the result | **Verified** | **Cross-checked** if revenue reconciles to gross profit (revenue, gross profit and gross margin claims), otherwise **Not cross-checked** |

In short, the language model and the verdict logic are identical for every company. What differs is how much independent evidence backs the figures: for the three hand-verified companies the figures have been compared line by line with the filings and are locked in by tests, while for others the only safeguard is the automatic data checks in step 6.

## Trust levels
Any company in the SEC's ticker list can be checked; each result carries a badge saying how far to trust the figures.
- **Verified** (Apple, Microsoft, Nvidia): every figure is pinned in `tests/verify.test.ts` to the income statements in the company's own 10-Ks (Apple FY2023–25, Microsoft FY2024–26, Nvidia FY2024–26).
- **Cross-checked**: revenue − cost of revenue reconciles to reported gross profit in every period (`lib/checks.ts`), which catches a wrong tag or segment figure.
- **Not cross-checked**: only sanity checks ran (no cost-of-revenue/gross-profit data to reconcile against, or the metric has no independent check, e.g. operating or net income). Tags can also define "revenue" differently from a company's headline number: Walmart's tag is net sales ($674.5B), not total revenues including membership income.
- **Refused ("Cannot verify")**: any failed check (revenue tag changes between periods, periods not consecutive, gross profit or operating income above revenue, revenue not reconciling to gross profit), no annual data (foreign filers, banks without a revenue tag), an ambiguous company name, or a claim naming several companies or a benchmark. A comparison is refused in code whatever the model parsed.

Fiscal-year labels follow each company's own naming from the filing (e.g. Nvidia's year ending Jan 2026 is FY2026).

Hand-verify another company by adding it to `lib/companies.mjs`, running `node scripts/build-snapshot.mjs`, and pinning its 10-K figures in the tests.

## Scope and limits
Annual (10-K) data for the last three fiscal years, US filers using us-gaap tags. Metrics: revenue, operating income, net income, gross profit, operating and gross margin. Not supported: quarterly data, EPS, guidance, comparisons between companies. A verdict covers the numeric part of a sentence; qualifiers such as "beat estimates" are not judged. Companies that are not hand-verified have no offline fallback if the SEC is unreachable.

## Run
```
cp .env.example .env.local   # add OPENAI_API_KEY
npm install
npm run dev
npm test
```
