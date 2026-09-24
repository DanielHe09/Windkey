import type { Result } from "./verify";

/** Newline-delimited JSON events streamed from /api/check. */
export type CheckEvent =
  | { type: "step"; text: string; kind?: "step" | "detail" | "verdict" }
  | { type: "result"; result: Result }
  | { type: "done"; source: "live" | "snapshot"; fetchedAt: string; truncated: boolean }
  | { type: "error"; error: string };
