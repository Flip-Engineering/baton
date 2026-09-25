// Worker adapter — the southbound boundary. One adapter per harness family.
// Ships a subprocess adapter that shells to `claude -p` / `codex exec --json`.
// This is the honest MVP surface: the durable value (the Referee) needs only
// spawn + result + a re-runnable verification — NOT the full app-server steering
// machinery, which is the Conductor branch earned by the eval.
//
// F1 fix (CRITIQUE.md): `run` is now async (real `spawn`, not blocking `spawnSync`),
// so the orchestrator's concurrency is genuine and the ceiling actually serializes.
// F6 (noted, not fully fixed): real kill-tree on timeout needs `detached` + process-group
// kill; here we SIGKILL the direct child — flagged so it's not mistaken for handled.
//
// GUARDRAIL: run() with live=true spends model quota. Only the eval enables it.

import { spawn } from "node:child_process";
import type { Brief, HarnessCard, WorkerResult } from "./types.js";

export interface Adapter {
  card(): HarnessCard;
  run(brief: Brief, opts: RunOpts): Promise<WorkerResult>;
}

export interface RunOpts {
  worktree: string;
  timeoutMs: number;
  live: boolean; // must be true to spend quota; default path is a structural dry-run
  model?: string;
  env?: Record<string, string>;
  simulateMs?: number; // dry-run only: pretend work takes this long, so concurrency is observable
}

function runProcess(cmd: string, args: string[], cwd: string, timeoutMs: number, env?: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) } });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs); // F6: direct-child only
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: 127, out }); });
  });
}

abstract class CliAdapter implements Adapter {
  abstract card(): HarnessCard;
  protected abstract argv(brief: Brief, o: RunOpts): { cmd: string; args: string[] };

  async run(brief: Brief, o: RunOpts): Promise<WorkerResult> {
    if (!o.live) {
      if (o.simulateMs) await new Promise((r) => setTimeout(r, o.simulateMs)); // makes concurrency visible in the demo
      return {
        status: "blocked", progress: 0,
        summary: `[dry-run] would run ${this.card().harness} on: ${brief.goal}`,
        artifacts: { commits: [], files: [] },
        verification: { command: brief.verification.command, claimedExit: -1 },
        blocker: "live=false (structural dry-run; no quota spent)",
        openQuestions: [], budgetUsed: { tokens: 0, usd: 0 },
      };
    }
    const { cmd, args } = this.argv(brief, o);
    const { code, out } = await runProcess(cmd, args, o.worktree, o.timeoutMs, o.env);
    // The worker SELF-REPORTS. The hub does NOT trust it — the Referee re-runs the
    // pinned verification in a fresh sandbox. This is only a claim.
    return {
      status: code === 0 ? "completed" : "failed",
      progress: code === 0 ? 1 : 0.5,
      summary: out.slice(0, 500),
      artifacts: { commits: [], files: [] }, // a real adapter reads `git rev-parse HEAD` / `git diff --name-only`
      verification: { command: brief.verification.command, claimedExit: code },
      openQuestions: [], budgetUsed: { tokens: 0, usd: 0 }, // a real adapter parses usage from --json
    };
  }
}

export class ClaudeAdapter extends CliAdapter {
  card(): HarnessCard {
    return { harness: "claude-code", version: "2.1.205", authPosture: "subscription", concurrencyCeiling: 4, maxContext: 200000,
      verbs: { spawn: "native", interrupt: "native", steer: "emulated", pause: "emulated" } };
  }
  protected argv(brief: Brief, o: RunOpts) {
    return { cmd: "claude", args: ["-p", renderBrief(brief, "claude"), "--permission-mode", "acceptEdits", ...(o.model ? ["--model", o.model] : [])] };
  }
}

export class CodexAdapter extends CliAdapter {
  card(): HarnessCard {
    return { harness: "codex", version: "0.144.0", authPosture: "subscription", concurrencyCeiling: 4, maxContext: 272000,
      verbs: { spawn: "native", interrupt: "native", steer: "native", pause: "unsupported" } };
  }
  protected argv(brief: Brief, _o: RunOpts) {
    return { cmd: "codex", args: ["exec", "--json", "--skip-git-repo-check", renderBrief(brief, "codex-v2")] };
  }
}

/** GLM leg = Claude adapter + Z.ai env (officially supported config, doc 01 §5); ceiling=1 (Pro tier). */
export class GlmAdapter extends ClaudeAdapter {
  card(): HarnessCard { return { ...super.card(), harness: "glm-via-claude", concurrencyCeiling: 1 }; }
}

/** Per-harness brief dialect (doc 12 §2 — semantics invariant, syntax projected). */
export function renderBrief(b: Brief, _dialect: "claude" | "codex-v2"): string {
  return [
    `Goal: ${b.goal}`,
    b.constraints.length ? `Constraints:\n- ${b.constraints.join("\n- ")}` : "",
    `Scope: ${b.pathScope.join(", ")}`,
    `Done when: ${b.definitionOfDone}`,
    `Verify with: ${b.verification.command} (expect exit ${b.verification.expectExit})`,
  ].filter(Boolean).join("\n"); // the seam where real Codex-vs-Claude dialect divergence lives
}
