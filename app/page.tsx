"use client";

import { useState } from "react";
import styles from "./page.module.css";

interface Evidence { label: string; value: string; url: string }
interface Claim { raw_text: string; metric: string | null; kind: string | null; direction: string | null; value: number | null; period: string | null; compare_to: string | null }
interface Result { claim: Claim; verdict: "SUPPORTED" | "INCORRECT" | "CANNOT_VERIFY"; arithmetic: string; reason?: string; evidence: Evidence[] }

const SAMPLE = "Apple's revenue rose 6.4% year over year, while operating margin fell. Diluted EPS was $7.46.";
const LABEL = { SUPPORTED: "Supported", INCORRECT: "Incorrect", CANNOT_VERIFY: "Cannot verify" } as const;
const ICON = { SUPPORTED: "✓", INCORRECT: "✕", CANNOT_VERIFY: "?" } as const;

function parsedAs(c: Claim): string {
  if (!c.metric || !c.kind) return "not a checkable claim";
  const parts = [c.metric.replace("_", " "), c.kind.replace("_", " ")];
  if (c.direction) parts.push(c.direction);
  if (c.value !== null) parts.push(String(c.value));
  parts.push(`${c.compare_to ?? "prior year"} → ${c.period ?? "latest year"}`);
  return parts.join(" · ");
}

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResults(data.results);
      setSource(data.source);
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Earnings claim checker</h1>
      <p className={styles.sub}>Paste 1–3 numerical claims about Apple (FY2023–FY2025). Each is checked against SEC 10-K filing data, with the arithmetic and source shown.</p>

      <textarea className={styles.input} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} aria-label="Draft earnings note" />
      <button className={styles.button} onClick={check} disabled={loading || !text.trim()}>{loading ? "Checking…" : "Check claims"}</button>

      {error && <p role="alert" className={styles.error}>{error}</p>}

      {results && results.length === 0 && <p className={styles.sub}>No numerical claims found in that text.</p>}
      {results?.map((r, i) => (
        <section key={i} className={styles.card}>
          <div className={styles.head}>
            <span className={`${styles.badge} ${styles[r.verdict]}`}><span aria-hidden>{ICON[r.verdict]}</span> {LABEL[r.verdict]}</span>
            <q className={styles.quote}>{r.claim.raw_text}</q>
          </div>
          <p className={styles.parsed}>Parsed as: {parsedAs(r.claim)}</p>
          {r.reason && <p className={styles.reason}>{r.reason}</p>}
          {r.arithmetic && <p className={styles.math}>{r.arithmetic}</p>}
          {r.evidence.length > 0 && (
            <ul className={styles.evidence}>
              {r.evidence.map((e, j) => (
                <li key={j}>{e.label}: <strong>{e.value}</strong> · <a href={e.url} target="_blank" rel="noreferrer">SEC filing ↗</a></li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className={styles.foot}>Language model only parses sentences into structured claims. Every figure, calculation and verdict is computed in code from SEC XBRL data. Demo: one company, three fiscal years.{source && ` Data source: ${source === "live" ? "SEC EDGAR (live, cached 24h)" : "bundled SEC snapshot (SEC unreachable)"}.`}</p>
    </main>
  );
}
