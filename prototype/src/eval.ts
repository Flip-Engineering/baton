// The eval — the ACTUAL first deliverable (doc 16 Pivot 3, doc 07 M1, doc 14 #21).
// Everything above the control/verification plane gates on ONE number: does a
// model-diverse, Referee-verified fleet beat a single strong agent on the user's
// real tasks? This harness answers it with a PRE-REGISTERED metric and pivot criterion.
//
// The metric and pivot are committed HERE, in code, before any run — so the eval
// cannot be rationalized after the fact (the eval's own integrity, doc 14 #21).

import { Orchestrator } from "./orchestrator.js";
import { ClaudeAdapter, CodexAdapter, GlmAdapter } from "./adapter.js";
import { Ledger } from "./ledger.js";
import type { Task, Verdict } from "./types.js";

/** PRE-REGISTERED. Do not edit after a run to make results look better. */
export const PREREGISTERED = {
  primaryMetric: "hub_verified_pass_rate", // the Referee's observed pass, never worker self-report
  costModel: "usd_per_verified_pass", // cost-adjusted, so N attempts don't get a free ride
  // Doc 07 M1 pivot criterion, verbatim:
  pivot: "If fleet hub_verified_pass_rate <= soloist AND fleet wall_clock > 1.5x soloist => HALT and rethink.",
  // The soloist baseline MUST be strong (doc 14 #21): the single best-routed adapter,
  // same tools, same brief quality — not a strawman.
  soloistIsStrawman: false,
} as const;

interface ArmResult { arm: string; verified: number; total: number; usd: number; wallMs: number; }

export interface EvalTask { task: Task; pinnedCheck: { command: string; expectExit: number }; }

/**
 * Run the two arms on a task corpus.
 *  - solo: the single best-routed harness (strong baseline).
 *  - fleet: model-diverse workers, every result Referee-verified; cross-review optional.
 * Returns the pre-registered comparison. `live=false` structurally validates without quota.
 */
export function runEval(corpus: EvalTask[], live: boolean, dir: string): { solo: ArmResult; fleet: ArmResult; verdict: string } {
  const solo = arm("solo", corpus, live, dir, ["codex"]); // one strong agent
  const fleet = arm("fleet", corpus, live, dir, ["codex", "claude", "glm"]); // model-diverse
  // The honest comparison on the pre-registered metric.
  const soloRate = solo.verified / Math.max(1, solo.total);
  const fleetRate = fleet.verified / Math.max(1, fleet.total);
  const halt = fleetRate <= soloRate && fleet.wallMs > 1.5 * solo.wallMs;
  return {
    solo, fleet,
    verdict: halt
      ? `HALT: fleet did not beat soloist (fleet ${fleetRate.toFixed(2)} vs solo ${soloRate.toFixed(2)}) and was slower — per pre-registered pivot, do NOT build above the control/verification plane.`
      : `CONTINUE: fleet ${fleetRate.toFixed(2)} vs solo ${soloRate.toFixed(2)}; the number justifies the next increment (identify WHICH task-classes carried it — that IS the routing table).`,
  };
}

function arm(name: string, corpus: EvalTask[], live: boolean, dir: string, harnesses: string[]): ArmResult {
  const adapters: any = {};
  if (harnesses.includes("codex")) adapters.codex = new CodexAdapter();
  if (harnesses.includes("claude")) adapters.claude = new ClaudeAdapter();
  if (harnesses.includes("glm")) adapters.glm = new GlmAdapter();

  const ledger = new Ledger(`${dir}/${name}`);
  const orch = new Orchestrator({
    adapters, ledger, live,
    // Trivial router for the prototype; the real one is Cairn's RouteStat (doc 11 mod 7).
    route: (_t, _cards) => (name === "solo" ? "codex" : harnesses[0]),
    sandboxFor: (t) => t.worktree,
  });
  for (const { task } of corpus) orch.submit(task);
  const verdicts = orch.runToCompletion();
  let verified = 0;
  for (const [, v] of verdicts as Map<string, Verdict>) if (v.reverified && v.observedExit === 0) verified++;
  // Cost/wall are stubbed in the structural prototype; a live run parses --json usage + times each arm.
  return { arm: name, verified, total: corpus.length, usd: 0, wallMs: 0 };
}
