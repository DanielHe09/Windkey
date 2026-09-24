# Earnings claim checker

Paste 1–3 numerical claims from a draft earnings note about any US-listed company. Each claim is checked against SEC 10-K XBRL data and returns **Supported / Incorrect / Cannot verify**, with the arithmetic, both source figures, and a link to the filing.

## Design: the LLM parses, deterministic code decides, a second LLM double-checks the reading
1. `lib/extract.ts` (LLM): the LLM turns each sentence into a structured claim (metric, kind, direction, stated value, period). It never sees SEC data and never outputs a verdict.
2. `lib/sec.ts` + `lib/sec-live.ts` (deterministic): figures come from SEC XBRL company facts, fetched live and cached 24h, with a bundled snapshot (`scripts/build-snapshot.mjs`) as fallback if the SEC is unreachable. Periods are matched by fiscal period **end date**; the original filing is cited, and later restatements are flagged.
3. `lib/verify.ts` (deterministic): pure functions compute the change and compare it with the claim at the claim's own stated precision ("6%" tolerates ±0.5pp; "6.4%" tolerates ±0.05pp). Anything unsupported returns "Cannot verify".
4. `lib/judge.ts` (LLM, last step): a second opinion on whether the sentence was read correctly. It never changes the verdict.

## LLM vs. deterministic
The LLM (`gpt-4o-mini`) is used for two jobs only, and does them the same way for every company. It never produces a verdict:
- **Step 1, parse (`lib/extract.ts`):** reads the note and fills in a structured claim (company as written, metric, direction, stated number, fiscal years, and a flag if the sentence compares companies). It sees no SEC data and does no arithmetic. Its output is validated against a strict schema and shown to the user as "Parsed as".
- **Step 8, second opinion (`lib/judge.ts`):** after a verdict exists, answers a fixed yes/no checklist about whether the parse matches the sentence. It sees only the sentence, the parse and the fiscal years used, never the SEC data, and cannot change the verdict.

Everything in between is deterministic: plain code with the same output for the same input, testable line by line.

| Step | Apple, Microsoft, Nvidia (verified) | Any other company |
|---|---|---|
| 1. Parse the sentence | LLM | LLM |
| 2. Refuse non-claims and comparisons (`screen` in `lib/verify.ts`) | Deterministic: no metric/kind, the LLM's comparison flag, or more than one of Apple/Microsoft/Nvidia named in the text | Same (the name check only recognizes those three, so for other companies a comparison is caught by the LLM's flag) |
| 3. Identify the company (`lib/resolve.ts`) | Deterministic: matched directly against the hand-verified list | Deterministic: matched against the SEC ticker list by ticker, exact name, or unique name prefix; ambiguous or unknown names are refused |
| 4. Get the figures (`lib/sec-live.ts`) | Deterministic: SEC XBRL company facts, live (cached 24h). If the SEC is unreachable, falls back to a bundled snapshot of the same data | Deterministic: SEC XBRL company facts, live (cached 24h). No fallback: if the SEC is unreachable the claim is refused |
| 5. Select the facts (`lib/sec.ts`) | Deterministic: match by fiscal period end date, cite the original 10-K, flag later restatements, label years as the company does | Same |
| 6. Data checks (`lib/checks.ts`) | Deterministic: consecutive periods, positive revenue, same revenue tag every period, gross profit and operating income ≤ revenue, revenue − cost of revenue = gross profit. Any failure refuses the claim | Same checks; any failure refuses the claim |
| 7. Compute and decide (`lib/verify.ts`) | Deterministic: percent change or margin calculation, compared with the claim at its stated precision | Same |
| Independent proof of the figures | Every figure is pinned in `tests/verify.test.ts` to the income statements in the company's own 10-Ks | None beyond step 6 |
| 8. Second opinion (`lib/judge.ts`), only when a verdict was produced | LLM yes/no checklist, see below | LLM yes/no checklist, see below |
| Badge on the result | **Verified** | **Cross-checked** if revenue reconciles to gross profit (revenue, gross profit and gross margin claims), otherwise **Not cross-checked** |

In short, the LLM steps and the deterministic verdict logic are identical for every company. What differs is how much independent evidence backs the figures: for the three hand-verified companies the figures have been compared line by line with the filings and are locked in by tests, while for others the only safeguard is the automatic data checks in step 6.

## The second-opinion check (LLM as judge)
The parse is the one place an LLM can quietly go wrong: a misread direction, number, company or year still produces a confident-looking verdict from perfectly good SEC data. So a second LLM call reviews the reading with a yes/no checklist (every question is phrased so that "yes" means fine):

| Question | Counts toward the threshold |
|---|---|
| Is the metric the one the sentence is about? | yes |
| Is the type of claim right (percent change, direction, or amount)? | yes |
| Does the direction used agree with the wording? | yes |
| Is the number exactly the one written, in the same unit? | yes |
| Is the company the one the sentence or note names? | yes |
| Does the year used match any year the sentence names? | yes |
| Is the whole sentence covered, with no extra qualifier ("beat estimates", a forecast) left unchecked? | no, adds a note only |

**Threshold:** `MAX_NO_ANSWERS = 0` in `lib/judge.ts`. Any "no" on the six parse questions marks the result "not sure this sentence was read correctly" and names the doubt, because a single misread word can flip a verdict. The wording is deliberately soft: it says the reading is uncertain, not that anything is wrong. The verdict itself is never changed or hidden. If the judge times out or replies malformed, the card shows nothing extra and the log says the second opinion was unavailable.

The judge runs only when a verdict was produced, uses `gpt-4o-mini` at temperature 0 (override with the `JUDGE_MODEL` environment variable), and writes its reason before its answer.

**How well it works:** on 14 hand-built cases with the real model, it flagged all 6 deliberately wrong readings (wrong direction, metric, number, company, year and unit) and passed 7 of 8 correct ones; the one false alarm was a "in 2024" sentence. That is a small sample, not a benchmark. Because the parser and the judge are the same model family, their mistakes can be correlated; pointing `JUDGE_MODEL` at a different model reduces that.

## Trust levels
Any company in the SEC's ticker list can be checked; each result carries a badge saying how far to trust the figures.
- **Verified** (Apple, Microsoft, Nvidia): every figure is pinned in `tests/verify.test.ts` to the income statements in the company's own 10-Ks (Apple FY2023–25, Microsoft FY2024–26, Nvidia FY2024–26).
- **Cross-checked**: revenue − cost of revenue reconciles to reported gross profit in every period (`lib/checks.ts`), which catches a wrong tag or segment figure.
- **Not cross-checked**: only sanity checks ran (no cost-of-revenue/gross-profit data to reconcile against, or the metric has no independent check, e.g. operating or net income). Tags can also define "revenue" differently from a company's headline number: Walmart's tag is net sales ($674.5B), not total revenues including membership income.
- **Refused ("Cannot verify")**: any failed check (revenue tag changes between periods, periods not consecutive, gross profit or operating income above revenue, revenue not reconciling to gross profit), no annual data (foreign filers, banks without a revenue tag), an ambiguous company name, or a claim naming several companies or a benchmark. A comparison is refused deterministically whatever the LLM parsed.

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
