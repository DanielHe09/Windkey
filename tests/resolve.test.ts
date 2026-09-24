import { describe, expect, it } from "vitest";
import { matchCompany, normalize, type Listed } from "@/lib/resolve";

const L = (ticker: string, title: string, cik: string): Listed => ({ ticker, title, cik });
const list = [
  L("TSLA", "Tesla, Inc.", "0001318605"),
  L("GOOGL", "Alphabet Inc.", "0001652044"),
  L("GOOG", "Alphabet Inc.", "0001652044"),
  L("META", "Meta Platforms, Inc.", "0001326801"),
  L("MEAT", "Meta Materials Inc.", "0001431959"),
  L("COST", "Costco Wholesale Corp /new", "0000909832"),
  L("AMZN", "AMAZON COM INC", "0001018724"),
  L("F", "FORD MOTOR CO", "0000037996"),
  L("DAL", "DELTA AIR LINES, INC.", "0000027904"),
  L("DLA", "DELTA APPAREL, INC.", "0000821002"),
];

describe("normalize", () => {
  it("drops punctuation and corporate suffixes", () => {
    expect(normalize("Tesla, Inc.")).toBe("tesla");
    expect(normalize("AMAZON COM INC")).toBe("amazon com");
    expect(normalize("The Coca-Cola Company")).toBe("coca cola");
  });
});

describe("matchCompany", () => {
  it("matches by ticker, case-insensitively", () => expect(matchCompany("tsla", list)).toMatchObject({ kind: "match", company: { ticker: "TSLA" } }));
  it("matches a short single-letter ticker", () => expect(matchCompany("F", list)).toMatchObject({ kind: "match", company: { ticker: "F" } }));
  it("matches an exact normalized name", () => expect(matchCompany("Tesla", list)).toMatchObject({ kind: "match", company: { ticker: "TSLA" } }));
  it("matches a unique word prefix", () => expect(matchCompany("Costco", list)).toMatchObject({ kind: "match", company: { ticker: "COST" } }));
  it("treats several share classes of one company as one match", () => expect(matchCompany("Alphabet", list)).toMatchObject({ kind: "match" }));
  it("is ambiguous when a prefix fits several companies", () => expect(matchCompany("Delta", list).kind).toBe("ambiguous"));
  it("prefers a ticker match over a name prefix ('Meta' is META)", () => expect(matchCompany("Meta", list)).toMatchObject({ kind: "match", company: { ticker: "META" } }));
  it("does not match inside a word", () => expect(matchCompany("Tes", list).kind).toBe("none"));
  it("returns none for unknown companies", () => expect(matchCompany("Nonexistent Widgets", list).kind).toBe("none"));
});
