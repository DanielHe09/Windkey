# Earnings claim checker

<video src="public/Windkey.mp4" controls muted width="720"></video>

[Watch the demo video](public/Windkey.mp4)

Paste 1–3 numerical claims from a draft earnings note about any US-listed company. Each claim is checked against SEC 10-K XBRL data and returns **Supported / Incorrect / Cannot verify**, with the arithmetic, both source figures, and a link to the filing.

**The idea:** a fluent answer isn't enough in finance; you should be able to inspect the numbers behind it. So the work is split:

- an **LLM** reads the sentence (step 2) and, at the end, double-checks that it was read correctly (step 10);
- **deterministic code** does everything in between: finds the company, fetches the filing data, sanity-checks it, does the arithmetic and decides the verdict. The LLM never produces a number or a verdict.

## The workflow, step by step

The app shows these steps live in a log as they happen. This is a real log for the note *"Apple's revenue rose 6.4% year over year. Microsoft's operating margin fell. Costco's revenue rose 8%."* (first claim only; steps 3–10 repeat for each claim):

```
Reading your note (102 characters)
Parsing sentences into structured claims. The LLM only labels them; it never computes or looks up numbers.
Found 3 claims to check
  1. "Apple's revenue rose 6.4% year over year." → Apple · revenue · pct change · up · 6.4
  2. "Microsoft's operating margin fell." → Microsoft · operating margin · direction · down
  3. "Costco's revenue rose 8%." → Costco · revenue · pct change · up · 8
Checking claim 1 of 3: "Apple's revenue rose 6.4% year over year."
  Company: Apple Inc. (AAPL), named in your note. Figures for this company were checked by hand against its 10-Ks.
  Loading SEC filing data for Apple Inc. (XBRL company facts from EDGAR)
  Loaded from SEC EDGAR (cached copy, 26 min old; cache refreshes every 24h)
  Found Revenue FY2025 (period ending 2025-09-27, 10-K filed 2025-10-31) = $416.161B
  Found Revenue FY2024 (period ending 2024-09-28, 10-K filed 2024-11-01) = $391.035B
  Data checks passed (10): Periods are consecutive fiscal years; Revenue is positive; Revenue − cost of revenue = gross profit; ...
  Comparing: ($416.161B − $391.035B) / $391.035B = +6.43% vs +6.4% claimed (tolerance ±0.05pp, from stated precision)
Verdict: supported
Second opinion: an LLM answers a yes/no checklist on whether the sentence was read correctly (it sees no SEC data and cannot change the verdict)
  Reading looks consistent with the sentence (6/6 yes)
```

### Step 1. Input checks and "Reading your note" (deterministic, `app/api/check/route.ts`)
Before anything runs, the request is rejected if the note is empty or over 1,000 characters, or if one client sends more than 10 requests a minute (a soft per-instance limit). Then the log starts.

### Step 2. Parse the sentences into claims (**LLM**, `lib/extract.ts`)
Log: *"Parsing sentences into structured claims…"*, then *"Found N claims"* with one line per claim.

The LLM (`gpt-4o-mini`, temperature 0, strict JSON schema) turns each checkable sentence into a structured claim: the company as written, the metric (revenue, operating income, net income, gross profit, operating or gross margin), the kind (percent change, direction, or amount), the direction, the stated number, the fiscal years named, and a flag if the sentence compares companies. It sees no SEC data and does no arithmetic. The output is validated against the schema, retried once, and shown to you as "Parsed as". At most 3 claims are taken; if there are more the log says so.

### Step 3. Screen the claim (deterministic, `screen` in `lib/verify.ts`)
Log: *"Checking claim i of N"*.

Refused as "Cannot verify" before any data is fetched: sentences that aren't a checkable claim about a supported metric (EPS, guidance, opinions), and any sentence comparing companies or a benchmark ("faster than Microsoft's", "outpaced the market"). The comparison refusal uses the LLM's flag and, independently, a text check for more than one of Apple/Microsoft/Nvidia, so a mis-parse can't quietly pick one company.

### Step 4. Identify the company (deterministic, `lib/resolve.ts`)
Log: *"Company: Apple Inc. (AAPL), named in your note. Figures for this company were checked by hand…"*

The name is matched by code, never by the LLM: first against the three hand-verified companies, then against the SEC's ticker list (by ticker, exact name, or a unique whole-word name prefix). If the note names no company, the "company" box is used. Ambiguous names ("Delta") and unknown names are refused with the reason.

### Step 5. Load the SEC filing data (deterministic, `lib/sec-live.ts`)
Log: *"Loading SEC filing data…"* then *"Loaded from SEC EDGAR (fetched just now / cached copy, N min old)"*.

The company's XBRL company facts are fetched live from the SEC, trimmed to annual 10-K rows and cached for 24 hours. For the three verified companies, if the SEC is unreachable the log says *"using the bundled snapshot"* and uses an offline copy of the same data. Other companies have no offline copy, so the claim is refused with the reason.

### Step 6. Select the facts (deterministic, `lib/sec.ts`)
Log: *"Found Revenue FY2025 (period ending 2025-09-27, 10-K filed 2025-10-31) = $416.161B"*, one line per figure.

Periods are matched by fiscal period **end date**. The original filing is cited (with a link to it on the card) and a later restatement is flagged. Years use the company's own labels from its filings (Nvidia's year ending January 2026 is FY2026), and the last three fiscal years are supported.

### Step 7. Data checks (deterministic, `lib/checks.ts`)
Log: *"Data checks passed (N): …"* or *"Data checks FAILED: …"*. The full list is on each card under "Data checks".

The SEC feed is standardized in format but not in content, so before trusting a figure the code checks it: periods are consecutive fiscal years (350–380 days apart), revenue is positive, the same revenue tag is used in every period, gross profit and operating income don't exceed revenue, and revenue − cost of revenue equals reported gross profit. Any failure means "Cannot verify"; the code refuses rather than guessing on figures that look wrong.

### Step 8. Compare and decide (deterministic, `lib/verify.ts`)
Log: *"Comparing: ($416.161B − $391.035B) / $391.035B = +6.43% vs +6.4% claimed (tolerance ±0.05pp, from stated precision)"*.

Pure functions compute the change, margin or amount and compare it with the claim at the claim's own stated precision: "6%" tolerates ±0.5 points, "6.4%" tolerates ±0.05. Margin claims are compared in percentage points.

### Step 9. Verdict (deterministic)
Log: *"Verdict: supported / incorrect / cannot verify"*. The card shows the arithmetic, both source figures, a link to each filing, and a trust badge (see below).

### Step 10. Second opinion (**LLM**, `lib/judge.ts`)
Log: *"Second opinion: an LLM answers a yes/no checklist…"* then *"Reading looks consistent (6/6 yes)"* or *"Not sure this sentence was read correctly (…)"*.

The parse is the one place an LLM can quietly go wrong: a misread direction, number, company or year still yields a confident verdict from perfectly good SEC data. So after the verdict, a second LLM call reviews the reading with a yes/no checklist. It sees only the sentence, the parse and the years used, never the SEC data, and it cannot change or hide the verdict. Every question is phrased so "yes" means fine:

| Question | Counts toward the threshold |
|---|---|
| Is the metric the one the sentence is about? | yes |
| Is the type of claim right (percent change, direction, or amount)? | yes |
| Does the direction used agree with the wording? | yes |
| Is the number exactly the one written, in the same unit? | yes |
| Is the company the one the sentence or note names? | yes |
| Does the year used match any year the sentence names? | yes |
| Is the whole sentence covered, with no extra qualifier ("beat estimates", a forecast) left unchecked? | no, adds a note only |

**Threshold:** `MAX_NO_ANSWERS = 0` in `lib/judge.ts`. Any "no" on the six parse questions marks the card "not sure this sentence was read correctly" and names the doubt, because one misread word can flip a verdict. The wording is deliberately soft: it says the reading is uncertain, not that anything is wrong. If the judge times out (12s) or replies malformed, the log says it was unavailable and the verdict stands alone. It runs only when a verdict was produced, at temperature 0, and writes its reason before its answer. Override the model with the `JUDGE_MODEL` environment variable.

**How well it works:** on 14 hand-built cases with the real model, it flagged all 6 deliberately wrong readings (wrong direction, metric, number, company, year and unit) and passed 7 of 8 correct ones; the one false alarm was an "in 2024" sentence. That is a small sample, not a benchmark. The parser and the judge are the same model family, so their mistakes can be correlated; pointing `JUDGE_MODEL` at a different model reduces that.

## Verified companies vs. everyone else

The LLM steps and the deterministic logic are identical for every company. What differs is how much independent evidence backs the figures.

| | Apple, Microsoft, Nvidia | Any other US-listed company |
|---|---|---|
| Company match (step 4) | Direct match against the hand-verified list | SEC ticker list; ambiguous or unknown names refused |
| SEC unreachable (step 5) | Falls back to a bundled snapshot | Claim refused |
| Data checks (step 7) | Same checks, any failure refuses | Same checks, any failure refuses |
| Independent proof of the figures | Every figure is pinned in `tests/verify.test.ts` to the income statements in the company's own 10-Ks (Apple FY2023–25, Microsoft FY2024–26, Nvidia FY2024–26) | None beyond step 7 |
| Badge on the result | **Verified** | **Cross-checked** or **Not cross-checked** |

## Trust levels
- **Verified** (Apple, Microsoft, Nvidia): figures compared line by line with the filings and locked in by tests.
- **Cross-checked**: revenue − cost of revenue reconciles to reported gross profit in every period (revenue, gross profit and gross margin claims), which catches a wrong tag or segment figure.
- **Not cross-checked**: only sanity checks ran (no cost-of-revenue or gross-profit data to reconcile against, or the metric has no independent check, e.g. operating or net income). Tags can also define "revenue" differently from a company's headline number: Walmart's tag is net sales ($674.5B), not total revenues including membership income.
- **Refused ("Cannot verify")**: any failed check, no annual data (foreign filers, banks without a revenue tag), an ambiguous or unknown company, or a claim naming several companies or a benchmark.

To hand-verify another company: add it to `lib/companies.mjs`, run `node scripts/build-snapshot.mjs`, and pin its 10-K figures in the tests.

## Scope and limits
Annual (10-K) data for the last three fiscal years, US filers using us-gaap tags. Metrics: revenue, operating income, net income, gross profit, operating and gross margin. Not supported: quarterly data, EPS, guidance, comparisons between companies. A verdict covers the numeric part of a sentence; qualifiers such as "beat estimates" are not judged (the second opinion notes them when it spots one). Companies that are not hand-verified have no offline fallback if the SEC is unreachable.

## Run
```
cp .env.example .env.local   # add OPENAI_API_KEY
npm install
npm run dev
npm test
```
