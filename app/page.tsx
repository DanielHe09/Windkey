"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckEvent } from "@/lib/events";
import styles from "./page.module.css";

interface Evidence { label: string; value: string; url: string }
interface Check { name: string; ok: boolean; detail: string }
interface Judgement { status: "consistent" | "unsure" | "unavailable"; yes: number; total: number; concerns: string[]; uncovered: string | null }
interface Claim { raw_text: string; company: string | null; metric: string | null; kind: string | null; direction: string | null; value: number | null; period: string | null; compare_to: string | null }
interface Result { claim: Claim; verdict: "SUPPORTED" | "INCORRECT" | "CANNOT_VERIFY"; arithmetic: string; reason?: string; evidence: Evidence[]; trust: "verified" | "cross-checked" | "unchecked" | null; checks: Check[]; judgement?: Judgement }

const SAMPLE = "Apple's revenue rose 6.4% year over year. Microsoft's operating margin fell. Costco's revenue rose 8%.";
const TRUST = {
  verified: "Verified: figures checked against the 10-K",
  "cross-checked": "Cross-checked: revenue reconciled to gross profit",
  unchecked: "Not cross-checked: SEC tags only (sanity checks passed)",
} as const;
interface Company { name: string; ticker: string; verified: boolean }
const LABEL = { SUPPORTED: "Supported", INCORRECT: "Incorrect", CANNOT_VERIFY: "Cannot verify" } as const;
const ICON = { SUPPORTED: "✓", INCORRECT: "✕", CANNOT_VERIFY: "?" } as const;

function parsedAs(c: Claim): string {
  if (!c.metric || !c.kind) return "not a checkable claim";
  const parts = [c.company ?? "", c.metric.replace("_", " "), c.kind.replace("_", " ")].filter(Boolean);
  if (c.direction) parts.push(c.direction);
  if (c.value !== null) parts.push(String(c.value));
  parts.push(`${c.compare_to ?? "prior year"} → ${c.period ?? "latest year"}`);
  return parts.join(" · ");
}

interface Step { text: string; kind?: "step" | "detail" | "verdict" }

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [steps, setSteps] = useState<Step[]>([]);
  const [company, setCompany] = useState("AAPL");
  const [results, setResults] = useState<{ result: Result; company: Company | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const logEnd = useRef<HTMLLIElement>(null);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }); }, [steps]);

  async function check() {
    setLoading(true);
    setError(null);
    setSteps([]);
    setResults([]);
    setSources([]);
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, company }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Something went wrong.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line) as CheckEvent;
          if (ev.type === "step") setSteps((s) => [...s, { text: ev.text, kind: ev.kind }]);
          else if (ev.type === "result") setResults((r) => [...r, { result: ev.result, company: ev.company }]);
          else if (ev.type === "done") setSources(ev.sources);
          else if (ev.type === "error") throw new Error(ev.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Earnings claim checker</h1>
      <p className={styles.sub}>Paste 1–3 numerical claims about any US-listed company (last three fiscal years). Each is checked against SEC 10-K filing data, with the arithmetic and source shown. Apple, Microsoft and Nvidia are hand-verified; other companies get automatic data checks and are refused if their figures look unreliable.</p>

      <textarea className={styles.input} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} aria-label="Draft earnings note" />
      <label className={styles.company}>
        Company when the note doesn&apos;t name one
        <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} placeholder="Name or ticker" />
      </label>
      <button className={styles.button} onClick={check} disabled={loading || !text.trim()}>{loading ? "Checking…" : "Check claims"}</button>

      {error && <p role="alert" className={styles.error}>{error}</p>}

      {steps.length > 0 && (
        <ol className={styles.log} aria-live="polite" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={i} className={`${styles.line} ${s.kind === "detail" ? styles.detail : ""} ${s.kind === "verdict" ? styles.verdictLine : ""}`}>
              <span className={styles.mark} aria-hidden>{i === steps.length - 1 && loading ? <span className={styles.pulse} /> : s.kind === "detail" ? "↳" : "✓"}</span>
              <span>{s.text}</span>
            </li>
          ))}
          <li ref={logEnd} aria-hidden />
        </ol>
      )}

      {results.map(({ result: r, company: co }, i) => (
        <section key={i} className={`${styles.card} ${r.judgement?.status === "unsure" ? styles.unsure : ""}`}>
          <div className={styles.head}>
            <span className={`${styles.badge} ${styles[r.verdict]}`}><span aria-hidden>{ICON[r.verdict]}</span> {LABEL[r.verdict]}</span>
            {co && <span className={styles.ticker}>{co.ticker}</span>}
            <q className={styles.quote}>{r.claim.raw_text}</q>
          </div>
          {r.trust && <p className={styles.trust}>{TRUST[r.trust]}</p>}
          {r.judgement?.status === "unsure" && (
            <p className={styles.notSure} role="status">
              Not sure this sentence was read correctly ({r.judgement.yes}/{r.judgement.total} checks agreed; unsure about {r.judgement.concerns.join(", ")}). Check &quot;Parsed as&quot; below before relying on this verdict.
            </p>
          )}
          {r.judgement?.status === "consistent" && <p className={styles.secondOpinion}>Second opinion: reading of the sentence looks consistent ({r.judgement.yes}/{r.judgement.total}).</p>}
          {r.judgement?.uncovered && <p className={styles.secondOpinion}>Not covered by this check: {r.judgement.uncovered}</p>}
          <p className={styles.parsed}>Parsed as: {parsedAs(r.claim)}</p>
          {r.reason && <p className={styles.reason}>{r.reason}</p>}
          {r.arithmetic && <p className={styles.math}>{r.arithmetic}</p>}
          {r.checks.length > 0 && (
            <details className={styles.checks}>
              <summary>Data checks ({r.checks.filter((k) => k.ok).length}/{r.checks.length} passed)</summary>
              <ul>{r.checks.map((k, j) => <li key={j}>{k.ok ? "✓" : "✕"} {k.name}: {k.detail}</li>)}</ul>
            </details>
          )}
          {r.evidence.length > 0 && (
            <ul className={styles.evidence}>
              {r.evidence.map((e, j) => (
                <li key={j}>{e.label}: <strong>{e.value}</strong> · <a href={e.url} target="_blank" rel="noreferrer">SEC filing ↗</a></li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className={styles.foot}>The LLM only parses sentences into structured claims. Every figure, calculation and verdict is computed deterministically from SEC XBRL data; a second LLM pass can only flag a reading it is unsure about. Demo: annual figures, last three fiscal years.{sources.length > 0 && ` Data source: ${sources.map((x) => (x === "live" ? "SEC EDGAR (live, cached 24h)" : "bundled SEC snapshot (SEC unreachable)")).join(" and ")}.`}</p>
    </main>
  );
}
