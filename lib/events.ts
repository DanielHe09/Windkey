import type { Result } from "./verify";

/** Newline-delimited JSON events streamed from /api/check. */
export type CheckEvent =
  | { type: "step"; text: string; kind?: "step" | "detail" | "verdict" }
  | { type: "result"; result: Result; company: { name: string; ticker: string; verified: boolean } | null }
  | { type: "done"; sources: ("live" | "snapshot")[]; truncated: boolean }
  | { type: "error"; error: string };
