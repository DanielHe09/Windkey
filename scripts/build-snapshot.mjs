// Fetches SEC XBRL company facts and trims them to the annual (10-K) facts the checker uses.
// Usage: node scripts/build-snapshot.mjs
import { writeFileSync } from "node:fs";

const CIK = "0000320193";
const TICKER = "AAPL";
const CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "OperatingIncomeLoss",
  "NetIncomeLoss",
  "GrossProfit",
];

const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${CIK}.json`, {
  headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
});
if (!res.ok) throw new Error(`SEC responded ${res.status}`);
const raw = await res.json();

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const facts = {};
for (const concept of CONCEPTS) {
  const rows = raw.facts["us-gaap"][concept]?.units?.USD ?? [];
  const annual = rows
    .filter((r) => r.form === "10-K" && r.fp === "FY" && r.start && days(r.start, r.end) > 350 && days(r.start, r.end) < 380)
    .map(({ start, end, val, accn, filed }) => ({ start, end, val, accn, filed }));
  if (annual.length) facts[concept] = annual;
}

writeFileSync(
  new URL("../data/aapl-facts.json", import.meta.url),
  JSON.stringify({ cik: CIK, ticker: TICKER, entityName: raw.entityName, fetchedAt: new Date().toISOString(), facts }, null, 1),
);
console.log("concepts:", Object.keys(facts).join(", "));
