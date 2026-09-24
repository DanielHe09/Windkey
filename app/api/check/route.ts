import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/extract";
import { verify } from "@/lib/verify";
import { availablePeriods, COMPANY } from "@/lib/sec";

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

  const extracted = await extractClaims(text);
  if (!extracted.ok) return NextResponse.json({ error: extracted.error }, { status: 502 });

  const periods = availablePeriods();
  const results = extracted.claims.map((c) => verify(c, periods));
  return NextResponse.json({ company: COMPANY.name, periods: Object.keys(periods), results });
}
