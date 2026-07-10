// The orchestrator — a DETERMINISTIC PROGRAM, not an LLM (doc 16 Pivot 1).
// Because the conductor is code, there is no event-loop problem, no context to
// poison, no orchestrator-death recovery, no nested-approval loop. The LLM lives
// ONLY inside adapters (the workers). This is the supervisor of docs 09/13 with
// no model on top of it.
//
// It owns: the task DAG (ready-work pull), fencing (I1), worker leases, GENUINELY
// CONCURRENT dispatch bounded by per-harness ceilings, and the trust gate (every
// accepted result routes through the Referee). Steering/interruption are the
// Conductor branch, built out only if the eval justifies it.
//
// Self-critique fixed here (see CRITIQUE.md): dispatch is now async + genuinely
// concurrent (F1), the ceiling is a real semaphore (F1), and the Referee runs in a
// caller-provided FRESH sandbox, never the worker's live worktree (F2).

import type { Adapter } from "./adapter.js";
import { referee, accept } from "./referee.js";
import { Ledger } from "./ledger.js";
import type { Fence, Task, TaskId, Verdict, WorkerId } from "./types.js";

export interface OrchestratorOpts {
  adapters: Record<string, Adapter>;
  ledger: Ledger;
  route: (task: Task, cards: Record<string, ReturnType<Adapter["card"]>>) => string;
  live: boolean;
  /** A FRESH sandbox populated from the worker's COMMITTED artifacts — never its live worktree (F2/doc 09 C2). */
  freshSandboxFor: (task: Task, result: import("./types.js").WorkerResult) => Promise<string>;
}

export class Orchestrator {
  private tasks = new Map<TaskId, Task>();
  private inFlight = new Map<string, number>();
  private fenceCounter = 0;
  private verdicts = new Map<TaskId, Verdict>();
  private running = new Set<TaskId>();

  constructor(private o: OrchestratorOpts) {}

  submit(task: Task) { this.tasks.set(task.id, task); }

  /** Dispatchable iff pending, not already running, and every dep completed. Pure over DAG state. */
  private ready(): Task[] {
    return [...this.tasks.values()].filter(
      (t) => t.status === "pending" && !this.running.has(t.id) &&
        t.deps.every((d) => this.tasks.get(d)?.status === "completed"),
    );
  }

  private cards() {
    return Object.fromEntries(Object.entries(this.o.adapters).map(([n, a]) => [n, a.card()]));
  }

  private nextFence(): Fence { return ++this.fenceCounter; }

  /**
   * Run the DAG to completion with REAL concurrency. Ready tasks whose harness has
   * ceiling headroom launch immediately and run in parallel; the ceiling is enforced
   * as a live semaphore (GLM's ceiling=1 serializes; Codex/Claude's ceiling=4 parallelize).
   * Determinism of OUTCOME (which tasks complete) holds given fixed worker outputs; only
   * interleaving varies — and the trust gate is order-independent.
   */
  async runToCompletion(): Promise<Map<TaskId, Verdict>> {
    const inflight = new Set<Promise<void>>();
    while (true) {
      // Launch every ready task that fits under its harness ceiling.
      for (const task of this.ready()) {
        const harness = this.o.route(task, this.cards());
        const ceiling = this.o.adapters[harness].card().concurrencyCeiling;
        if ((this.inFlight.get(harness) ?? 0) >= ceiling) continue;
        const p = this.dispatch(task, harness).finally(() => inflight.delete(p));
        inflight.add(p);
      }
      if (inflight.size === 0) break; // nothing ready and nothing running => DAG drained or blocked
      await Promise.race(inflight); // wait for the next completion, then re-evaluate readiness
    }
    return this.verdicts;
  }

  private async dispatch(task: Task, harness: string): Promise<void> {
    const adapter = this.o.adapters[harness];
    const worker: WorkerId = `w_${harness}_${task.id}`;
    const fence = this.nextFence();
    this.running.add(task.id);
    this.inFlight.set(harness, (this.inFlight.get(harness) ?? 0) + 1);
    task.status = "working"; task.assignee = worker;
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_started", actor: "orchestrator", payload: { task: task.id } });

    // The worker runs (the ONLY place an LLM is invoked). Async so the fleet is truly concurrent.
    const result = await adapter.run(task.brief, {
      worktree: task.worktree, timeoutMs: task.brief.budget.wallMin * 60_000, live: this.o.live,
    });
    task.result = result;

    // THE TRUST GATE — the Referee re-runs the PINNED verification in a FRESH sandbox
    // built from the worker's COMMITTED artifacts (F2 fix). Worker prose never counts (I7).
    const sandbox = await this.o.freshSandboxFor(task, result);
    const verdict: Verdict = await referee(task, result, {
      pinnedVerification: { command: task.brief.verification.command, expectExit: task.brief.verification.expectExit },
      sandbox, live: this.o.live,
    });
    this.verdicts.set(task.id, verdict);
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "verify.reverified", actor: "policy", payload: verdict });

    // `completed` ONLY if the hub itself observed a pass. Not on the worker's say-so.
    task.status = accept(verdict, task.brief.verification.expectExit) ? "completed" : "failed";
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_completed", actor: "orchestrator", payload: { status: task.status } });

    this.inFlight.set(harness, (this.inFlight.get(harness) ?? 1) - 1);
    this.running.delete(task.id);
  }

  snapshot() {
    return {
      tasks: [...this.tasks.values()].map((t) => ({ id: t.id, status: t.status, assignee: t.assignee })),
      verdicts: [...this.verdicts.entries()].map(([id, v]) => ({ id, reverified: v.reverified, observedExit: v.observedExit, note: v.note })),
    };
  }
}
