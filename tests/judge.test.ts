import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuestions, judgeParse, MAX_NO_ANSWERS, scoreAnswers, type Answer } from "@/lib/judge";
import type { Claim, Result } from "@/lib/verify";

const claim: Claim = {
  raw_text: "Apple's revenue rose 6.4% year over year.",
  company: "Apple",
  compares_companies: false,
  metric: "revenue",
  kind: "pct_change",
  direction: "up",
  value: 6.4,
  period: null,
  compare_to: null,
  unsupported_reason: null,
};
const ctx = { note: claim.raw_text, company: "Apple Inc.", claim, periods: ["FY2024", "FY2025"] };
const qs = buildQuestions(ctx);
const allYes: Answer[] = qs.map((q) => ({ id: q.id, answer: true, reason: "ok" }));
const withNo = (...ids: string[]) => allYes.map((a) => (ids.includes(a.id) ? { ...a, answer: false } : a));

describe("checklist", () => {
  it("has six parse-fidelity questions and one coverage question", () => {
    expect(qs.filter((q) => q.critical).map((q) => q.id)).toEqual(["metric", "kind", "direction", "number", "company", "periods"]);
    expect(qs.filter((q) => !q.critical).map((q) => q.id)).toEqual(["covered"]);
  });
  it("puts the program's reading into the questions", () => {
    const text = qs.map((q) => q.text).join("\n");
    expect(text).toContain('"revenue"');
    expect(text).toContain("6.4%");
    expect(text).toContain("FY2024 vs FY2025");
    expect(text).toContain("Apple Inc.");
  });
});

describe("scoreAnswers (threshold)", () => {
  it("is consistent when every parse-fidelity answer is yes", () => {
    expect(scoreAnswers(qs, allYes)).toMatchObject({ status: "consistent", yes: 6, total: 6, concerns: [], uncovered: null });
  });
  it(`is unsure as soon as more than ${MAX_NO_ANSWERS} of them is no, and names the concern`, () => {
    expect(scoreAnswers(qs, withNo("direction"))).toMatchObject({ status: "unsure", yes: 5, concerns: ["the direction (rose/fell)"] });
    expect(scoreAnswers(qs, withNo("number", "company")).concerns).toEqual(["the number or unit", "the company"]);
  });
  it("a 'no' on the coverage question only adds a note; it never makes the reading unsure", () => {
    const r = scoreAnswers(qs, allYes.map((a) => (a.id === "covered" ? { ...a, answer: false, reason: "also says it beat estimates" } : a)));
    expect(r.status).toBe("consistent");
    expect(r.uncovered).toBe("also says it beat estimates");
  });
  it("is unavailable when the judge left questions unanswered", () => {
    expect(scoreAnswers(qs, allYes.slice(0, 3)).status).toBe("unavailable");
  });
});

describe("judgeParse", () => {
  afterEach(() => vi.unstubAllGlobals());
  const result = { claim, verdict: "SUPPORTED", arithmetic: "", evidence: [], trust: "verified", checks: [], periods: ["FY2024", "FY2025"] } as Result;

  it("reports unavailable (never a verdict change, never an error) when the API call fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect((await judgeParse({ ...ctx, result })).status).toBe("unavailable");
  });
  it("reports unavailable when the reply is malformed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const body = { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{\"nope\":1}" } }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })));
    expect((await judgeParse({ ...ctx, result })).status).toBe("unavailable");
  });

  it("uses the default model when JUDGE_MODEL is set but empty", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("JUDGE_MODEL", "");
    const fetchMock = vi.fn().mockRejectedValue(new Error("stop here"));
    vi.stubGlobal("fetch", fetchMock);
    await judgeParse({ ...ctx, result });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.model).toBe("gpt-4o-mini");
  });
});
