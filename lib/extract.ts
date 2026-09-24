import OpenAI from "openai";
import { z } from "zod";
import { ClaimSchema, type Claim } from "./verify";

export const MAX_CLAIMS = 3;
const MODEL = "gpt-4o-mini";

const ExtractionSchema = z.object({ claims: z.array(ClaimSchema) });

const SYSTEM = `You convert sentences from a draft earnings note into structured claims. You do NOT verify, compute, or look up any number; a separate program does that.

Company under review: Apple Inc. (fiscal years end in late September; label them FY2023, FY2024, FY2025).
Supported metrics: revenue, operating_income, net_income, gross_profit, operating_margin, gross_margin.
Supported kinds:
- pct_change: a stated percentage change (value = the percent as a positive number, direction = "up" or "down").
- direction: rose/fell/grew/declined with no number (direction = "up" or "down").
- level: a stated amount (value in USD billions for dollar metrics, or percent for margins).

Rules:
- Return one claim per checkable numerical/directional statement, at most ${MAX_CLAIMS}, in order. raw_text is the sentence or clause copied verbatim.
- "period" / "compare_to": use FY labels only if the text names the years; otherwise null (the program treats null as latest year vs. the prior year).
- If the statement is not a checkable claim about a supported metric (other metric such as EPS, another company, forecasts, opinions, vague language), set metric and kind to null and give a short unsupported_reason. Never guess.
- Copy numbers exactly as written (keep their stated precision, e.g. 18 vs 18.0). Do not convert, round, or infer figures that were not stated.
- Set fields that do not apply to null.`;

export type ExtractResult = { ok: true; claims: Claim[]; truncated: boolean } | { ok: false; error: string };

export async function extractClaims(text: string): Promise<ExtractResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Server is missing OPENAI_API_KEY." };
  const client = new OpenAI({ apiKey });
  const { $schema: _omit, ...schema } = z.toJSONSchema(ExtractionSchema) as Record<string, unknown>;
  void _omit;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `<draft_note>\n${text}\n</draft_note>` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "claims", strict: true, schema } },
      });
      const content = res.choices[0]?.message?.content;
      const parsed = ExtractionSchema.safeParse(content ? JSON.parse(content) : null);
      if (parsed.success) return { ok: true, claims: parsed.data.claims.slice(0, MAX_CLAIMS), truncated: parsed.data.claims.length > MAX_CLAIMS };
    } catch (e) {
      if (attempt === 1) return { ok: false, error: `Claim extraction failed: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }
  return { ok: false, error: "Could not parse the note into claims." };
}
