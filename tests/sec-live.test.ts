import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { loadFacts } from "@/lib/sec-live";

const AAPL = { ticker: "AAPL", name: "Apple Inc.", cik: "0000320193", verified: true };
const OTHER = { ticker: "XYZ", name: "Example Corp", cik: "0000000001", verified: false };

afterEach(() => vi.unstubAllGlobals());

describe("loadFacts", () => {
  it("falls back to the bundled snapshot when the SEC is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await loadFacts(AAPL);
    expect(r.source).toBe("snapshot");
    expect(Object.keys(r.facts).length).toBeGreaterThan(0);
  });

  it("falls back when the SEC returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadFacts(AAPL)).source).toBe("snapshot");
  });

  it("falls back when the SEC data lacks the expected periods", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ facts: { "us-gaap": {} } }) }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadFacts(AAPL)).source).toBe("snapshot");
  });

  it("has no fallback for a company that is not hand-verified: it reports the failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(loadFacts(OTHER)).rejects.toThrow(/Could not load SEC filing data for Example Corp/);
  });
});
