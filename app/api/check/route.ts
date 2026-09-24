import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/extract";
import { depsFor, refuse, screen, verify, type Claim, type Result } from "@/lib/verify";
import type { CheckEvent } from "@/lib/events";
import { judgeParse } from "@/lib/judge";
import { type CompanyRef, resolveCompany } from "@/lib/resolve";
import { type LoadedFacts, loadFacts } from "@/lib/sec-live";

const MAX_CHARS = 1000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Paste a sentence or two from an earnings note." }, { status: 400 });
  const selectedName = typeof body?.company === "string" && body.company.trim() ? body.company.trim().slice(0, 80) : "AAPL";
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `Keep it under ${MAX_CHARS} characters.` }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: CheckEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const step = (text: string, kind?: "step" | "detail" | "verdict") => send({ type: "step", text, kind });
      try {
        step(`Reading your note (${text.length} characters)`);
        step("Parsing sentences into structured claims. The LLM only labels them; it never computes or looks up numbers.");
        const extracted = await extractClaims(text);
        if (!extracted.ok) return send({ type: "error", error: extracted.error });

        const { claims, truncated } = extracted;
        step(claims.length ? `Found ${claims.length} claim${claims.length === 1 ? "" : "s"} to check` : "No numerical claims found");
        claims.forEach((c, i) => step(`${i + 1}. "${c.raw_text}" → ${describe(c)}`, "detail"));
        if (truncated) step(`Only the first ${claims.length} claims are checked`, "detail");

        const loaded = new Map<string, LoadedFacts>();
        const sources = new Set<"live" | "snapshot">();
        for (const [i, claim] of claims.entries()) {
          await pace();
          step(`Checking claim ${i + 1} of ${claims.length}: "${claim.raw_text}"`);
          let result: Result;
          let company: CompanyRef | null = null;

          const screened = screen(claim);
          if (screened) {
            result = screened;
          } else {
            const query = claim.company ?? selectedName;
            const resolved = await resolveCompany(query);
            if (!resolved.ok) {
              result = refuse(claim, resolved.reason);
            } else {
              company = resolved.company;
              step(
                `Company: ${company.name} (${company.ticker}), ${claim.company ? "named in your note" : "from the company box"}. ${
                  company.verified ? "Figures for this company were checked by hand against its 10-Ks." : "Not hand-verified; figures are cross-checked automatically."
                }`,
                "detail",
              );
              try {
                if (!loaded.has(company.cik)) {
                  step(`Loading SEC filing data for ${company.name} (XBRL company facts from EDGAR)`, "detail");
                  const data = await loadFacts(company);
                  loaded.set(company.cik, data);
                  const ageMin = Math.round((Date.now() - Date.parse(data.fetchedAt)) / 60000);
                  step(
                    data.source === "live"
                      ? `Loaded from SEC EDGAR (${ageMin < 1 ? "fetched just now" : `cached copy, ${ageMin} min old`}; cache refreshes every 24h)`
                      : "SEC EDGAR unreachable: using the bundled snapshot of the same 10-K data",
                    "detail",
                  );
                }
                const data = loaded.get(company.cik)!;
                sources.add(data.source);
                result = verify(claim, depsFor(data.facts, company.cik, company.verified));
              } catch (e) {
                result = refuse(claim, e instanceof Error ? e.message : "Could not load SEC data.");
              }
            }
          }

          // Start the second-opinion call now so its latency overlaps with the log lines below.
          const judging =
            company && result.verdict !== "CANNOT_VERIFY"
              ? judgeParse({ note: text, company: company.name, claim, periods: result.periods, result })
              : null;
          for (const e of result.evidence) {
            await pace();
            step(`Found ${e.label} = ${e.value}`, "detail");
          }
          if (result.checks.length) {
            await pace();
            const failed = result.checks.filter((k) => !k.ok);
            step(
              failed.length
                ? `Data checks FAILED: ${failed.map((k) => k.name).join("; ")}`
                : `Data checks passed (${result.checks.length}): ${result.checks.map((k) => k.name.replace(/ \(.*\)$/, "")).filter((n, j, all) => all.indexOf(n) === j).join("; ")}`,
              "detail",
            );
          }
          await pace();
          step(result.arithmetic ? `Comparing: ${result.arithmetic}` : `Not checkable: ${result.reason}`, "detail");
          step(`Verdict: ${VERDICT_TEXT[result.verdict]}`, "verdict");
          if (judging) {
            step("Second opinion: an LLM answers a yes/no checklist on whether the sentence was read correctly (it sees no SEC data and cannot change the verdict)");
            const j = await judging;
            result = { ...result, judgement: j };
            step(
              j.status === "unavailable"
                ? "Second opinion unavailable; the verdict above stands on its own"
                : j.status === "consistent"
                  ? `Reading looks consistent with the sentence (${j.yes}/${j.total} yes)`
                  : `Not sure this sentence was read correctly (${j.yes}/${j.total} yes; unsure about ${j.concerns.join(", ")}). Check "Parsed as".`,
              "detail",
            );
          }
          send({ type: "result", result, company: company && { name: company.name, ticker: company.ticker, verified: company.verified } });
        }
        send({ type: "done", sources: [...sources], truncated });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

const VERDICT_TEXT = { SUPPORTED: "supported", INCORRECT: "incorrect", CANNOT_VERIFY: "cannot verify" } as const;

// The lookup and math take milliseconds; a short pause between lines keeps the log readable when watched live.
const pace = () => new Promise((r) => setTimeout(r, 350));

function describe(c: Claim): string {
  if (!c.metric || !c.kind) return "not checkable";
  const parts = [c.company ?? "", c.metric.replace("_", " "), c.kind.replace("_", " ")].filter(Boolean);
  if (c.direction) parts.push(c.direction);
  if (c.value !== null) parts.push(String(c.value));
  return parts.join(" · ");
}
