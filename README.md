# Earnings claim checker

Paste 1–3 numerical claims from a draft earnings note about Apple. Each claim is checked against SEC 10-K XBRL data and returns **Supported / Incorrect / Cannot verify**, with the arithmetic, both source figures, and a link to the filing.

## Design: the language model parses, code decides
1. `lib/extract.ts`: the model turns each sentence into a structured claim (metric, kind, direction, stated value, period). It never sees SEC data and never outputs a verdict.
2. `lib/sec.ts` + `lib/sec-live.ts`: figures come from SEC XBRL company facts, fetched live and cached 24h, with a bundled snapshot (`scripts/build-snapshot.mjs`) as fallback if the SEC is unreachable. Periods are matched by fiscal period **end date**; the original filing is cited, and later restatements are flagged.
3. `lib/verify.ts`: pure functions compute the change and compare it with the claim at the claim's own stated precision ("6%" tolerates ±0.5pp; "6.4%" tolerates ±0.05pp). Anything unsupported returns "Cannot verify".

The snapshot and tests are checked against the income statements in Apple's FY2023–FY2025 10-Ks (`tests/verify.test.ts`).

## Scope and limits
One company (Apple), FY2023–FY2025 annual data. Metrics: revenue, operating income, net income, gross profit, operating and gross margin. Not supported: quarterly data, EPS, guidance, other companies.

## Run
```
cp .env.example .env.local   # add OPENAI_API_KEY
npm install
npm run dev
npm test
```
