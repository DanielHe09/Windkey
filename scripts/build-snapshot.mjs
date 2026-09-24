// Fetches SEC XBRL company facts and saves the trimmed annual facts as the offline fallback snapshot.
// Usage: node scripts/build-snapshot.mjs
import { writeFileSync } from "node:fs";
import { trimCompanyFacts } from "../lib/trim.mjs";

const CIK = "0000320193";
const TICKER = "AAPL";

const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${CIK}.json`, {
  headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
});
if (!res.ok) throw new Error(`SEC responded ${res.status}`);
const raw = await res.json();
const facts = trimCompanyFacts(raw);

writeFileSync(
  new URL("../data/aapl-facts.json", import.meta.url),
  JSON.stringify({ cik: CIK, ticker: TICKER, entityName: raw.entityName, fetchedAt: new Date().toISOString(), facts }, null, 1),
);
console.log("concepts:", Object.keys(facts).join(", "));
