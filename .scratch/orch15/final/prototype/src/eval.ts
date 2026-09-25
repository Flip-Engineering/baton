// Optional eval harness — de-risks ONE supporting feature (does a different-vendor
// check catch defects a same-vendor check misses?). This is NOT a go/no-go on building
// the fleet driver (doc 19 retired that framing) — it's a measurement you can run once
// there's history, to decide whether cross-vendor re-verification earns a second vendor's
// cost. The metric and pivot are committed HERE, before any run, so results can't be
// rationalized after the fact.

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
export async function runEval(corpus: EvalTask[], live: boolean, dir: string): Promise<{ solo: ArmResult; fleet: ArmResult; verdict: string }> {
  const solo = await arm("solo", corpus, live, dir, ["codex"]); // one strong agent
  const fleet = await arm("fleet", corpus, live, dir, ["codex", "claude", "glm"]); // model-diverse
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

async function arm(name: string, corpus: EvalTask[], live: boolean, dir: string, harnesses: string[]): Promise<ArmResult> {
  const adapters: any = {};
  if (harnesses.includes("codex")) adapters.codex = new CodexAdapter();
  if (harnesses.includes("claude")) adapters.claude = new ClaudeAdapter();
  if (harnesses.includes("glm")) adapters.glm = new GlmAdapter();
  const names = Object.keys(adapters);

  const ledger = new Ledger(`${dir}/${name}`);
  const orch = new Orchestrator({
    adapters, ledger, live,
    // F3 fix: the fleet arm is ACTUALLY model-diverse. A review task must run on a DIFFERENT
    // family than the impl it reviews (decorrelation is the whole point). The real router is
    // Cairn's RouteStat (doc 11 mod 7); this is a deterministic diverse placeholder.
    route: (t, _cards) => {
      if (name === "solo") return "codex"; // strong single baseline
      if (/review/.test(t.id)) return names.find((n) => n !== "codex") ?? names[0]; // different family reviews
      return names[Math.abs(hash(t.id)) % names.length]; // spread impl work across vendors
    },
    // F2 fix: a FRESH sandbox from the worker's committed artifacts, never its live worktree.
    // A real hub does `git worktree add <fresh> <worker-commit>`; the dry prototype returns a path.
    freshSandboxFor: async (t, _r) => `${t.worktree}.verify`,
  });
  for (const { task } of corpus) orch.submit(task);
  const verdicts = await orch.runToCompletion();
  let verified = 0;
  for (const [, v] of verdicts as Map<string, Verdict>) if (v.reverified && v.observedExit === 0) verified++;
  // Cost/wall stubbed structurally; a live run parses --json usage + times each arm (doc 14 #19).
  return { arm: name, verified, total: corpus.length, usd: 0, wallMs: 0 };
}

function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
