// Worker adapter — the southbound boundary. One adapter per harness family.
// The prototype ships a subprocess adapter that shells to `claude -p` / `codex exec`
// (headless one-shot). This is the honest MVP surface: the durable value (the Referee,
// doc 16) needs only spawn + result + a re-runnable verification — NOT the full
// app-server steering machinery, which is the Conductor branch earned by the eval.
//
// GUARDRAIL: spawn() actually invokes a real CLI and spends model quota. It is only
// called by the eval when explicitly enabled. Nothing here runs on import.

import { spawnSync } from "node:child_process";
import type { Brief, HarnessCard, WorkerResult } from "./types.js";

export interface Adapter {
  card(): HarnessCard;
  /** Run a brief to completion headlessly. Returns the worker's (non-authoritative) result. */
  run(brief: Brief, opts: RunOpts): WorkerResult;
}

export interface RunOpts {
  worktree: string;
  timeoutMs: number;
  /** Must be true to actually spend quota. Default false => dry structural run. */
  live: boolean;
  model?: string;
  env?: Record<string, string>;
}

/** Shared subprocess mechanics for CLI harnesses that take a prompt and edit a worktree. */
abstract class CliAdapter implements Adapter {
  abstract card(): HarnessCard;
  protected abstract argv(brief: Brief, o: RunOpts): { cmd: string; args: string[] };

  run(brief: Brief, o: RunOpts): WorkerResult {
    if (!o.live) {
      return {
        status: "blocked",
        progress: 0,
        summary: `[dry-run] would run ${this.card().harness} on: ${brief.goal}`,
        artifacts: { commits: [], files: [] },
        verification: { command: brief.verification.command, claimedExit: -1 },
        blocker: "live=false (structural dry-run; no quota spent)",
        openQuestions: [],
        budgetUsed: { tokens: 0, usd: 0 },
      };
    }
    const { cmd, args } = this.argv(brief, o);
    const r = spawnSync(cmd, args, {
      cwd: o.worktree,
      timeout: o.timeoutMs,
      encoding: "utf8",
      env: { ...process.env, ...(o.env ?? {}) }, // scoped env: a GLM worker gets only Z.ai auth (doc 09 C4)
    });
    // The worker SELF-REPORTS success here. The hub does NOT trust it — the Referee
    // (referee.ts) re-runs brief.verification independently. This claim is just a claim.
    const claimedExit = r.status ?? 1;
    return {
      status: claimedExit === 0 ? "completed" : "failed",
      progress: claimedExit === 0 ? 1 : 0.5,
      summary: (r.stdout ?? "").slice(0, 500),
      artifacts: { commits: [], files: [] }, // a real adapter reads `git diff --name-only`
      verification: { command: brief.verification.command, claimedExit },
      openQuestions: [],
      budgetUsed: { tokens: 0, usd: 0 }, // a real adapter parses usage from --json output
    };
  }
}

export class ClaudeAdapter extends CliAdapter {
  card(): HarnessCard {
    return {
      harness: "claude-code", version: "2.1.205", authPosture: "subscription",
      concurrencyCeiling: 4, maxContext: 200000,
      verbs: { spawn: "native", interrupt: "native", steer: "emulated", pause: "emulated" },
    };
  }
  protected argv(brief: Brief, o: RunOpts) {
    return {
      cmd: "claude",
      args: ["-p", renderBrief(brief, "claude"),
        "--permission-mode", "acceptEdits",
        ...(o.model ? ["--model", o.model] : [])],
    };
  }
}

export class CodexAdapter extends CliAdapter {
  card(): HarnessCard {
    return {
      harness: "codex", version: "0.144.0", authPosture: "subscription",
      concurrencyCeiling: 4, maxContext: 272000,
      verbs: { spawn: "native", interrupt: "native", steer: "native", pause: "unsupported" },
    };
  }
  protected argv(brief: Brief, o: RunOpts) {
    // exec-server / app-server is the richer surface; exec --json is the honest MVP one.
    return { cmd: "codex", args: ["exec", "--json", "--skip-git-repo-check", renderBrief(brief, "codex-v2")] };
  }
}

/** GLM leg = Claude adapter + Z.ai env (officially supported config, doc 01 §5). */
export class GlmAdapter extends ClaudeAdapter {
  card(): HarnessCard {
    return { ...super.card(), harness: "glm-via-claude", concurrencyCeiling: 1 /* Pro tier ≈ 1 in-flight */ };
  }
}

/** Per-harness brief dialect (doc 12 §2 — semantics invariant, syntax projected). */
export function renderBrief(b: Brief, dialect: "claude" | "codex-v2"): string {
  const core = [
    `Goal: ${b.goal}`,
    b.constraints.length ? `Constraints:\n- ${b.constraints.join("\n- ")}` : "",
    `Scope: ${b.pathScope.join(", ")}`,
    `Done when: ${b.definitionOfDone}`,
    `Verify with: ${b.verification.command} (expect exit ${b.verification.expectExit})`,
  ].filter(Boolean).join("\n");
  // Real dialects differ in structure/voice/placement; this is the seam where that lives.
  return dialect === "codex-v2" ? core : core;
}
