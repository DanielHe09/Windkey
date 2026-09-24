import { unstable_cache } from "next/cache";
import type { CompanyRef } from "./resolve";
import { availablePeriods, type Row } from "./sec";
import { SNAPSHOTS } from "./snapshots";
import { trimCompanyFacts } from "./trim.mjs";

const REVALIDATE_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;

export interface LoadedFacts {
  facts: Record<string, Row[]>;
  source: "live" | "snapshot";
  fetchedAt: string;
}

// The raw SEC response (up to several MB) is over Next's 2MB fetch-cache limit, so the trimmed result is cached instead.
const fetchLive = (cik: string) =>
  unstable_cache(
    async (): Promise<{ facts: Record<string, Row[]>; fetchedAt: string }> => {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`SEC responded ${res.status}`);
      const facts = trimCompanyFacts(await res.json()) as Record<string, Row[]>;
      if (!Object.keys(facts).length) throw new Error("no annual us-gaap facts");
      // Sanity check: the periods we support must exist, otherwise treat as a bad response.
      if (Object.keys(availablePeriods(facts)).length < 2) throw new Error("SEC data missing expected annual periods");
      return { facts, fetchedAt: new Date().toISOString() };
    },
    ["sec-company-facts", cik],
    { revalidate: REVALIDATE_SECONDS },
  )();

/**
 * Live SEC data (cached 24h). Hand-verified companies fall back to a bundled snapshot if the SEC is unreachable;
 * other companies have no fallback, so the error is thrown for the caller to report.
 */
export async function loadFacts(company: CompanyRef): Promise<LoadedFacts> {
  try {
    return { ...(await fetchLive(company.cik)), source: "live" };
  } catch (e) {
    const snap = company.verified ? SNAPSHOTS[company.ticker] : undefined;
    if (!snap) throw new Error(`Could not load SEC filing data for ${company.name}: ${e instanceof Error ? e.message : "unknown error"}`);
    console.warn(`SEC live fetch failed for ${company.ticker}, using snapshot:`, e instanceof Error ? e.message : e);
    return { facts: snap.facts, source: "snapshot", fetchedAt: snap.fetchedAt };
  }
}
