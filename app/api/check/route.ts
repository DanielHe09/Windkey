import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/extract";
import { verify, type Claim } from "@/lib/verify";
import type { CheckEvent } from "@/lib/events";
import { availablePeriods, getFact } from "@/lib/sec";
import { loadFacts } from "@/lib/sec-live";

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
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `Keep it under ${MAX_CHARS} characters.` }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: CheckEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const step = (text: string, kind?: "step" | "detail" | "verdict") => send({ type: "step", text, kind });
      try {
        step(`Reading your note (${text.length} characters)`);
        step("Parsing sentences into structured claims. The language model only labels them; it never computes or looks up numbers.");
        const extracted = await extractClaims(text);
        if (!extracted.ok) return send({ type: "error", error: extracted.error });

        const { claims, truncated } = extracted;
        step(claims.length ? `Found ${claims.length} claim${claims.length === 1 ? "" : "s"} to check` : "No numerical claims found");
        claims.forEach((c, i) => step(`${i + 1}. "${c.raw_text}" → ${describe(c)}`, "detail"));
        if (truncated) step(`Only the first ${claims.length} claims are checked`, "detail");

        step("Loading SEC filing data for Apple Inc. (XBRL company facts from EDGAR)");
        const { facts, source, fetchedAt } = await loadFacts();
        const ageMin = Math.round((Date.now() - Date.parse(fetchedAt)) / 60000);
        step(
          source === "live"
            ? `Loaded from SEC EDGAR (${ageMin < 1 ? "fetched just now" : `cached copy, ${ageMin} min old`}; cache refreshes every 24h)`
            : "SEC EDGAR unreachable: using the bundled snapshot of the same 10-K data",
          "detail",
        );

        const periods = availablePeriods(facts);
        const deps = { periods, fact: (m: Parameters<typeof getFact>[0], end: string) => getFact(m, end, facts) };
        for (const [i, claim] of claims.entries()) {
          await pace();
          step(`Checking claim ${i + 1} of ${claims.length}: "${claim.raw_text}"`);
          const result = verify(claim, periods, deps);
          for (const e of result.evidence) {
            await pace();
            step(`Found ${e.label} = ${e.value}`, "detail");
          }
          await pace();
          step(result.arithmetic ? `Comparing: ${result.arithmetic}` : `Not checkable: ${result.reason}`, "detail");
          step(`Verdict: ${VERDICT_TEXT[result.verdict]}`, "verdict");
          send({ type: "result", result });
        }
        send({ type: "done", source, fetchedAt, truncated });
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
  const parts = [c.metric.replace("_", " "), c.kind.replace("_", " ")];
  if (c.direction) parts.push(c.direction);
  if (c.value !== null) parts.push(String(c.value));
  return parts.join(" · ");
}
