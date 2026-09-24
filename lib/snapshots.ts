import aapl from "@/data/aapl-facts.json";
import msft from "@/data/msft-facts.json";
import nvda from "@/data/nvda-facts.json";
import type { Row } from "./sec";

export interface Snapshot {
  cik: string;
  ticker: string;
  entityName: string;
  fetchedAt: string;
  facts: Record<string, Row[]>;
}

/** Bundled offline copies of the SEC facts (scripts/build-snapshot.mjs), used if the SEC is unreachable. */
export const SNAPSHOTS: Record<string, Snapshot> = {
  AAPL: aapl as Snapshot,
  MSFT: msft as Snapshot,
  NVDA: nvda as Snapshot,
};
