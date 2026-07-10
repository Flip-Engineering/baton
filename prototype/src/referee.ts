// The Referee — the durable core (doc 13 T5, doc 16 §2). Independent, hub-run
// verification: the hub RE-RUNS a worker's claimed verification in a sandbox the
// worker did not control, and trusts only what IT observes (I7 / doc 09 C1-C2).
//
// This is the ~50 lines that carry most of baton's real, un-vendorable value:
// no vendor will grade itself against a competitor; this consumes artifacts
// (exit codes, diffs), so it's ToS-clean; and it IS the "verify" half that
// compounds as models improve (doc 12 §4).

import { spawnSync } from "node:child_process";
import type { Task, Verdict, WorkerResult } from "./types.js";

export interface RefereeOpts {
  /** The spec/grader command is PINNED by the human/orchestrator, never worker-supplied (doc 13 T5). */
  pinnedVerification: { command: string; expectExit: number };
  /** Fresh throwaway sandbox path; verification runs HERE, never on the hub (doc 09 C2). */
  sandbox: string;
  live: boolean;
}

/**
 * Re-derive the truth of a worker's result. The worker's own `verification.claimedExit`
 * is IGNORED except to detect divergence — a worker that forges a green check gains nothing,
 * because we re-run the pinned command ourselves.
 */
export function referee(task: Task, result: WorkerResult, o: RefereeOpts): Verdict {
  if (!o.live) {
    return {
      reverified: false, observedExit: null, matchesClaim: false,
      locus: "fresh_sandbox",
      note: "[dry-run] would re-run pinned verification in a fresh sandbox and compare to the worker's claim",
    };
  }
  // Re-run the PINNED verification (not the worker-reported one — a worker can weaken
  // its own spec until it passes, doc 13 T1). We use the human/orchestrator-pinned command.
  const r = spawnSync("bash", ["-lc", o.pinnedVerification.command], {
    cwd: o.sandbox, encoding: "utf8", timeout: 120_000,
  });
  const observedExit = r.status ?? 1;
  const matchesClaim = observedExit === result.verification.claimedExit;
  const passed = observedExit === o.pinnedVerification.expectExit;
  return {
    reverified: true,
    observedExit,
    matchesClaim,
    locus: "fresh_sandbox",
    note: passed
      ? `PASS — hub observed exit ${observedExit} on pinned check`
      : `FAIL — hub observed exit ${observedExit}, expected ${o.pinnedVerification.expectExit}` +
        (matchesClaim ? "" : ` (worker CLAIMED exit ${result.verification.claimedExit} — divergence)`),
  };
}

/** A decision is trustworthy iff the hub reverified it and observed a pass. Prose never counts. */
export function accept(verdict: Verdict, expectExit: number): boolean {
  return verdict.reverified && verdict.observedExit === expectExit;
}
