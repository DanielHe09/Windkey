import { unstable_cache } from "next/cache";
import snapshot from "@/data/aapl-facts.json";
import { availablePeriods, COMPANY, type Row } from "./sec";
import { trimCompanyFacts } from "./trim.mjs";

const REVALIDATE_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 8000;

export interface LoadedFacts {
  facts: Record<string, Row[]>;
  source: "live" | "snapshot";
  fetchedAt: string;
}

// The raw SEC response (~4MB) is over Next's 2MB fetch-cache limit, so the trimmed result is cached instead.
const fetchLive = unstable_cache(
  async (): Promise<{ facts: Record<string, Row[]>; fetchedAt: string }> => {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${COMPANY.cik}.json`, {
      headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SEC responded ${res.status}`);
    const facts = trimCompanyFacts(await res.json()) as Record<string, Row[]>;
    // Sanity check: the periods we support must exist, otherwise treat as a bad response.
    if (Object.keys(availablePeriods(facts)).length < 2) throw new Error("SEC data missing expected annual periods");
    return { facts, fetchedAt: new Date().toISOString() };
  },
  ["sec-company-facts", COMPANY.cik],
  { revalidate: REVALIDATE_SECONDS },
);

/** Live SEC data (cached 24h); falls back to the bundled snapshot if the SEC is unreachable or returns bad data. */
export async function loadFacts(): Promise<LoadedFacts> {
  try {
    return { ...(await fetchLive()), source: "live" };
  } catch (e) {
    console.warn("SEC live fetch failed, using snapshot:", e instanceof Error ? e.message : e);
    return { facts: snapshot.facts as Record<string, Row[]>, source: "snapshot", fetchedAt: snapshot.fetchedAt };
  }
}
