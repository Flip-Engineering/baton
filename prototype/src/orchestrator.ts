// The orchestrator — a DETERMINISTIC PROGRAM, not an LLM (doc 16 Pivot 1).
// Because the conductor is code, there is no event-loop problem, no context to
// poison, no orchestrator-death recovery, no nested-approval loop. The LLM lives
// ONLY inside adapters (the workers). This class is the supervisor of docs 09/13,
// finally with no model sitting on top of it.
//
// It owns: the task DAG (ready-work pull), fencing (I1), worker leases, dispatch
// under per-harness concurrency ceilings, and the trust gate (route every accepted
// result through the Referee). Steering/interruption are the Conductor branch —
// stubbed here behind the same fencing, built out only if the eval justifies it.

import type { Adapter } from "./adapter.js";
import { referee, accept } from "./referee.js";
import { Ledger } from "./ledger.js";
import type { Fence, Task, TaskId, Verdict, WorkerId } from "./types.js";

interface Lease { worker: WorkerId; fence: Fence; taskId: TaskId; }

export interface OrchestratorOpts {
  adapters: Record<string, Adapter>; // harness name -> adapter
  ledger: Ledger;
  route: (task: Task, cards: Record<string, ReturnType<Adapter["card"]>>) => string; // returns harness name
  live: boolean;
  sandboxFor: (task: Task) => string; // fresh sandbox for the Referee's re-run
}

export class Orchestrator {
  private tasks = new Map<TaskId, Task>();
  private leases = new Map<WorkerId, Lease>();
  private inFlightByHarness = new Map<string, number>();
  private fenceCounter = 0;
  private verdicts = new Map<TaskId, Verdict>();

  constructor(private o: OrchestratorOpts) {}

  submit(task: Task) { this.tasks.set(task.id, task); }

  /** A task is dispatchable iff pending and every dep is completed. Pure function of DAG state. */
  private ready(): Task[] {
    return [...this.tasks.values()].filter(
      (t) => t.status === "pending" && t.deps.every((d) => this.tasks.get(d)?.status === "completed"),
    );
  }

  private cards() {
    return Object.fromEntries(Object.entries(this.o.adapters).map(([n, a]) => [n, a.card()]));
  }

  /** Fencing (I1): every control op carries the fence it was issued against; stale ops are rejected. */
  private nextFence(): Fence { return ++this.fenceCounter; }

  /**
   * Run the DAG to completion. Deterministic: same DAG + same routing + same worker
   * outputs => same execution. Concurrency is bounded by each harness's card ceiling
   * (Z.ai Pro ≈ 1 is a hard input here, not a retry loop).
   */
  runToCompletion(): Map<TaskId, Verdict> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const task of this.ready()) {
        const harness = this.o.route(task, this.cards());
        const adapter = this.o.adapters[harness];
        const ceiling = adapter.card().concurrencyCeiling;
        if ((this.inFlightByHarness.get(harness) ?? 0) >= ceiling) continue; // respect the ceiling
        this.dispatch(task, harness, adapter);
        progressed = true;
      }
    }
    return this.verdicts;
  }

  private dispatch(task: Task, harness: string, adapter: Adapter) {
    const worker: WorkerId = `w_${harness}_${task.id}`;
    const fence = this.nextFence();
    this.leases.set(worker, { worker, fence, taskId: task.id });
    this.inFlightByHarness.set(harness, (this.inFlightByHarness.get(harness) ?? 0) + 1);
    task.status = "working"; task.assignee = worker;
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_started", actor: "orchestrator", payload: { task: task.id } });

    // The worker runs (this is the ONLY place an LLM is invoked).
    const result = adapter.run(task.brief, {
      worktree: task.worktree, timeoutMs: task.brief.budget.wallMin * 60_000, live: this.o.live,
    });
    task.result = result;

    // THE TRUST GATE — the Referee re-runs verification; worker prose never counts (I7).
    const verdict: Verdict = referee(task, result, {
      pinnedVerification: { command: task.brief.verification.command, expectExit: task.brief.verification.expectExit },
      sandbox: this.o.sandboxFor(task),
      live: this.o.live,
    });
    this.verdicts.set(task.id, verdict);
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "verify.reverified", actor: "policy", payload: verdict });

    // A task is `completed` ONLY if the hub itself observed a pass. Not on the worker's say-so.
    task.status = accept(verdict, task.brief.verification.expectExit) ? "completed" : "failed";
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_completed", actor: "orchestrator", payload: { status: task.status } });

    this.inFlightByHarness.set(harness, (this.inFlightByHarness.get(harness) ?? 1) - 1);
    this.leases.delete(worker);
  }

  snapshot() {
    return {
      tasks: [...this.tasks.values()].map((t) => ({ id: t.id, status: t.status, assignee: t.assignee })),
      verdicts: [...this.verdicts.entries()].map(([id, v]) => ({ id, reverified: v.reverified, observedExit: v.observedExit, note: v.note })),
    };
  }
}
