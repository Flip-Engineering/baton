// The Referee — the durable core (doc 13 T5, doc 16 §2). Independent, hub-run
// verification: the hub RE-RUNS a worker's claimed verification in a sandbox the
// worker did not control, and trusts only what IT observes (I7 / doc 09 C1-C2).
//
// This is the ~50 lines that carry most of baton's real, un-vendorable value:
// no vendor will grade itself against a competitor; this consumes artifacts
// (exit codes, diffs), so it's ToS-clean; and it IS the "verify" half that
// compounds as models improve (doc 12 §4).

import { spawn } from "node:child_process";
import type { Task, Verdict, WorkerResult } from "./types.js";

export interface RefereeOpts {
  /** The spec/grader command is PINNED by the human/orchestrator, never worker-supplied (doc 13 T5). */
  pinnedVerification: { command: string; expectExit: number };
  /**
   * A FRESH sandbox the orchestrator built from the worker's COMMITTED artifacts (F2 fix) —
   * NOT the worker's live worktree. Verification runs here, never on the hub (doc 09 C2), so a
   * worker can't leave a poisoned conftest/test-binary in its worktree to fool the re-check.
   */
  sandbox: string;
  live: boolean;
}

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd });
    const t = setTimeout(() => c.kill("SIGKILL"), 120_000);
    c.on("close", (code) => { clearTimeout(t); resolve(code ?? 1); });
    c.on("error", () => { clearTimeout(t); resolve(127); });
  });
}

/**
 * Re-derive the truth of a worker's result. The worker's own `verification.claimedExit`
 * is IGNORED except to detect divergence — a worker that forges a green check gains nothing,
 * because we re-run the pinned command ourselves in a sandbox it didn't control.
 */
export async function referee(task: Task, result: WorkerResult, o: RefereeOpts): Promise<Verdict> {
  if (!o.live) {
    return {
      reverified: false, observedExit: null, matchesClaim: false, locus: "fresh_sandbox",
      note: "[dry-run] would re-run the PINNED verification in a fresh sandbox (built from committed artifacts) and compare to the worker's claim",
    };
  }
  // Re-run the PINNED verification (not the worker-reported one — a worker can weaken its
  // own spec until it passes, doc 13 T1), in the fresh sandbox.
  const observedExit = await run("bash", ["-lc", o.pinnedVerification.command], o.sandbox);
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

// A real orchestrator builds the fresh sandbox by checking out the worker's committed
// artifacts (e.g. `git worktree add <sandbox> <worker-commit>`), NEVER by pointing at the
// worker's live worktree. The eval provides freshSandboxFor to do exactly that.
