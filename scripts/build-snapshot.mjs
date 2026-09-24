// Fetches SEC XBRL company facts for every supported company and saves the trimmed annual facts
// as the offline fallback snapshots (data/<ticker>-facts.json).
// Usage: node scripts/build-snapshot.mjs
import { writeFileSync } from "node:fs";
import { COMPANIES } from "../lib/companies.mjs";
import { trimCompanyFacts } from "../lib/trim.mjs";

for (const { ticker, cik } of COMPANIES) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
  });
  if (!res.ok) throw new Error(`SEC responded ${res.status} for ${ticker}`);
  const raw = await res.json();
  const facts = trimCompanyFacts(raw);
  writeFileSync(
    new URL(`../data/${ticker.toLowerCase()}-facts.json`, import.meta.url),
    JSON.stringify({ cik, ticker, entityName: raw.entityName, fetchedAt: new Date().toISOString(), facts }, null, 1),
  );
  console.log(ticker, raw.entityName, "concepts:", Object.keys(facts).join(", "));
  await new Promise((r) => setTimeout(r, 500));
}
