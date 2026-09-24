import { unstable_cache } from "next/cache";
import { COMPANIES } from "./companies.mjs";

export interface CompanyRef {
  ticker: string;
  name: string;
  cik: string;
  /** True for companies whose figures were checked by hand against their 10-Ks (lib/companies.mjs). */
  verified: boolean;
}

export interface Listed {
  cik: string;
  ticker: string;
  title: string;
}

const SUFFIX_WORDS = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the|class [a-z]|common stock)\b/g;

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Match = { kind: "match"; company: Listed } | { kind: "ambiguous"; options: Listed[] } | { kind: "none" };

/** Match by ticker, then exact normalized name, then a unique whole-word name prefix ("Nike" → "Nike Inc"). */
export function matchCompany(query: string, list: Listed[]): Match {
  const q = normalize(query);
  const raw = query.trim().toLowerCase();
  if (!q && !raw) return { kind: "none" };

  const byCik = new Map<string, Listed>();
  for (const l of list) if (!byCik.has(l.cik)) byCik.set(l.cik, l); // several share classes per company
  const unique = [...byCik.values()];

  const tick = !raw.includes(" ") ? list.find((l) => l.ticker.toLowerCase() === raw) : undefined;
  if (tick) return { kind: "match", company: tick };
  const exact = unique.filter((l) => normalize(l.title) === q);
  if (exact.length === 1) return { kind: "match", company: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", options: exact.slice(0, 3) };
  const prefix = unique.filter((l) => normalize(l.title).startsWith(q + " "));
  if (prefix.length === 1) return { kind: "match", company: prefix[0] };
  if (prefix.length > 1) return { kind: "ambiguous", options: prefix.slice(0, 3) };
  return { kind: "none" };
}

const loadList = unstable_cache(
  async (): Promise<Listed[]> => {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": "Windkey claim checker demo dandanhe09@gmail.com" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SEC responded ${res.status}`);
    const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    return Object.values(raw).map((r) => ({ cik: String(r.cik_str).padStart(10, "0"), ticker: r.ticker, title: r.title }));
  },
  ["sec-company-tickers"],
  { revalidate: 24 * 60 * 60 },
);

export type Resolved = { ok: true; company: CompanyRef } | { ok: false; reason: string };

/** Turn a company name or ticker as written in the note into a company with a CIK. Hand-verified companies win first. */
export async function resolveCompany(query: string): Promise<Resolved> {
  const q = normalize(query);
  const verified = COMPANIES.find((c) => c.ticker.toLowerCase() === query.trim().toLowerCase() || normalize(c.name) === q || normalize(c.name).split(" ")[0] === q);
  if (verified) return { ok: true, company: { ...verified, verified: true } };

  let list: Listed[];
  try {
    list = await loadList();
  } catch {
    return { ok: false, reason: "Company lookup is unavailable right now (SEC ticker list unreachable)." };
  }
  const m = matchCompany(query, list);
  if (m.kind === "match") {
    const known = COMPANIES.find((c) => c.cik === m.company.cik);
    return { ok: true, company: { ticker: m.company.ticker, name: m.company.title, cik: m.company.cik, verified: Boolean(known) } };
  }
  if (m.kind === "ambiguous") return { ok: false, reason: `"${query}" matches several companies (${m.options.map((o) => `${o.title} (${o.ticker})`).join(", ")}). Use the ticker.` };
  return { ok: false, reason: `Could not find "${query}" among SEC-registered US companies.` };
}
