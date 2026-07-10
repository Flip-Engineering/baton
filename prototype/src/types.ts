// baton prototype — core types.
// Reflects the honest architecture (doc 16 Pivot 1): the orchestrator is a
// deterministic program; LLMs are ONLY workers. So there is no "orchestrator
// context window," no fleet_wait bridge, no orchestrator-death recovery — those
// problems don't exist for a program. What remains real: fencing, an append-only
// ledger with at-least-once cursors, two-phase stop, and hub-run verification (I7).

export type WorkerId = string;
export type TaskId = string;
export type Fence = number; // monotonic per worker; higher authority => higher fence (doc 05 I1)

/** A unit of delegated work. Status vocabulary borrowed from A2A / MCP-tasks (doc 03). */
export interface Task {
  id: TaskId;
  brief: Brief;
  deps: TaskId[]; // dispatchable iff every dep is `completed`
  status: "pending" | "working" | "input_required" | "completed" | "failed" | "cancelled";
  assignee: WorkerId | null;
  worktree: string; // isolation boundary (git worktree)
  refines?: TaskId; // A2A referenceTaskIds — a terminal task is immutable; refine = new task
  result?: WorkerResult;
}

/** The only context a worker gets. Authored per-harness (Codex ≠ Claude dialect). Doc 06 Q6 / spec/communication-channel §3. */
export interface Brief {
  goal: string;
  constraints: string[];
  pathScope: string[];
  definitionOfDone: string;
  /** The verification is a CLAIM the worker will report; the hub RE-RUNS it (I7). */
  verification: { command: string; expectExit: number };
  budget: { tokens: number; usd: number; wallMin: number };
  /** Bulky context (repo map, prior diffs) passed by handle, not inlined (doc 12 §1a). */
  orientationRef?: string;
  briefTemplate?: "codex-v2" | "claude" | "glm";
}

/** A worker's terminal output. NON-AUTHORITATIVE — the hub never trusts `verification` (doc 09 C1). */
export interface WorkerResult {
  status: "completed" | "failed" | "blocked" | "cancelled";
  progress: number; // 0..1 — graceful partial delivery (doc 14 #3): the truth is rarely binary
  summary: string;
  artifacts: { commits: string[]; diffRef?: string; files: string[] };
  verification: { command: string; claimedExit: number; tailRef?: string }; // a CLAIM
  blocker?: string; // precise, when status=blocked — what the orchestrator needs to route the next move
  openQuestions: string[];
  budgetUsed: { tokens: number; usd: number };
}

/** The hub's independent re-derivation of a worker's claim (I7). This is the Referee. */
export interface Verdict {
  reverified: boolean; // did the hub re-run the check itself?
  observedExit: number | null; // what the HUB saw, not what the worker reported
  matchesClaim: boolean; // observedExit === claimedExit
  locus: "worker_sandbox" | "fresh_sandbox"; // NEVER "hub" (doc 09 C2)
  note: string;
}

/** Normalized event. Every control op, capability op, and lifecycle change is one of these. */
export interface BatonEvent {
  seq: number; // per-worker monotonic, gap-flagged
  ts: string; // hub-stamped authoritative time (clock-skew defense)
  worker: WorkerId;
  harness: string; // e.g. "codex@0.144.0"
  turnEpoch: number; // fencing scope (doc 13 T2 — turn-scoped)
  kind: EventKind;
  actor: "worker" | "orchestrator" | "human" | "policy";
  emulated?: boolean; // no silent emulation — a faked primitive says so
  payload: unknown;
}

export type EventKind =
  | "lifecycle.spawned" | "lifecycle.turn_started" | "lifecycle.turn_completed"
  | "lifecycle.session_compacted" | "lifecycle.exited" | "lifecycle.crashed"
  | "control.interrupt_requested" | "control.interrupt_confirmed" | "control.steer" | "control.nudge"
  | "approval.requested" | "approval.resolved"
  | "resource.tokens" | "resource.budget_threshold"
  | "health.stall_suspected" | "health.loop_suspected" | "verify.reverified" | "error";

/** Per-harness capability negotiation (doc 02). Verbs degrade explicitly, never silently. */
export interface HarnessCard {
  harness: string;
  version: string;
  authPosture: "subscription" | "api_key";
  concurrencyCeiling: number; // HARD scheduler input (Z.ai Pro ≈ 1) — not a retry concern
  maxContext: number;
  verbs: Record<string, "native" | "emulated" | "unsupported">;
}
