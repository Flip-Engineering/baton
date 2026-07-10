// Runnable demo of the honest MVP (doc 16): deterministic orchestrator + Referee + eval,
// in DRY-RUN mode (live=false) so it spends ZERO model quota and touches no real repo.
// It proves the skeleton executes end-to-end and the trust gate is wired correctly.
//
// Run: node demo.mjs   (pure Node, no build step — this file inlines the JS the .ts compiles to)

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Minimal inlined runtime (mirrors src/*.ts; the .ts files are the real source) ---

class Ledger {
  constructor(dir) { this.dir = dir; this.events = []; this.seq = new Map(); }
  append(e) { const s = (this.seq.get(e.worker) ?? 0) + 1; this.seq.set(e.worker, s); const f = { ...e, seq: s }; this.events.push(f); return f; }
}

function referee(task, result, o) {
  if (!o.live) return { reverified: false, observedExit: null, matchesClaim: false, locus: "fresh_sandbox", note: "[dry-run] would re-run pinned check in a fresh sandbox" };
  // live path would spawnSync the pinned command; omitted in the dry demo.
  return { reverified: true, observedExit: 0, matchesClaim: true, locus: "fresh_sandbox", note: "PASS" };
}
const accept = (v, expect) => v.reverified && v.observedExit === expect;

class DryAdapter {
  constructor(name, ceiling) { this.name = name; this.ceiling = ceiling; }
  card() { return { harness: this.name, concurrencyCeiling: this.ceiling }; }
  run(brief) {
    // Dry: worker CLAIMS success. The hub will NOT trust this — Referee re-checks.
    return { status: "completed", progress: 1, summary: `[dry] ${this.name} would attempt: ${brief.goal}`,
      artifacts: { commits: [], files: [] }, verification: { command: brief.verification.command, claimedExit: 0 }, openQuestions: [], budgetUsed: { tokens: 0, usd: 0 } };
  }
}

class Orchestrator {
  constructor(o) { this.o = o; this.tasks = new Map(); this.inFlight = new Map(); this.fence = 0; this.verdicts = new Map(); }
  submit(t) { this.tasks.set(t.id, t); }
  ready() { return [...this.tasks.values()].filter(t => t.status === "pending" && t.deps.every(d => this.tasks.get(d)?.status === "completed")); }
  runToCompletion() {
    let go = true;
    while (go) { go = false;
      for (const t of this.ready()) {
        const h = this.o.route(t); const a = this.o.adapters[h];
        if ((this.inFlight.get(h) ?? 0) >= a.card().concurrencyCeiling) continue;
        this.dispatch(t, h, a); go = true;
      } }
    return this.verdicts;
  }
  dispatch(task, harness, adapter) {
    const worker = `w_${harness}_${task.id}`; const fence = ++this.fence;
    this.inFlight.set(harness, (this.inFlight.get(harness) ?? 0) + 1);
    task.status = "working"; task.assignee = worker;
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_started", actor: "orchestrator", payload: { task: task.id } });
    const result = adapter.run(task.brief);
    const verdict = referee(task, result, { live: this.o.live });
    this.verdicts.set(task.id, verdict);
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "verify.reverified", actor: "policy", payload: verdict });
    // completed ONLY if the hub itself observed a pass (dry-run => never trusts the claim => failed-pending-verification)
    task.status = accept(verdict, task.brief.verification.expectExit) ? "completed" : "failed";
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_completed", actor: "orchestrator", payload: { status: task.status } });
    this.inFlight.set(harness, this.inFlight.get(harness) - 1);
  }
  snapshot() { return { tasks: [...this.tasks.values()].map(t => ({ id: t.id, status: t.status, assignee: t.assignee })),
    verdicts: [...this.verdicts.entries()].map(([id, v]) => ({ id, note: v.note })) }; }
}

// --- The demo scenario ---

const dir = mkdtempSync(join(tmpdir(), "baton-demo-"));
const ledger = new Ledger(dir);
const adapters = { codex: new DryAdapter("codex", 4), claude: new DryAdapter("claude", 4), glm: new DryAdapter("glm-via-claude", 1) };

const mkTask = (id, goal, deps = []) => ({
  id, deps, status: "pending", assignee: null, worktree: `${dir}/${id}`,
  brief: { goal, constraints: [], pathScope: ["src/"], definitionOfDone: goal,
    verification: { command: "pytest -q", expectExit: 0 }, budget: { tokens: 1e5, usd: 5, wallMin: 20 } },
});

const orch = new Orchestrator({ adapters, ledger, live: false, route: (t) => (t.id.startsWith("glm") ? "glm" : t.id.startsWith("cl") ? "claude" : "codex") });
orch.submit(mkTask("codex-impl", "Implement the auth token refresh"));
orch.submit(mkTask("cl-review", "Review the auth change from a different model family", ["codex-impl"])); // cross-review: depends on impl
orch.submit(mkTask("glm-tests", "Add property tests for token expiry", ["codex-impl"]));

console.log("=== baton prototype — deterministic orchestrator + Referee (DRY-RUN, zero quota) ===\n");
orch.runToCompletion();
console.log(JSON.stringify(orch.snapshot(), null, 2));
console.log(`\nledger events: ${ledger.events.length}`);
console.log("\nKey property demonstrated: every task's status came from the Referee's verdict,");
console.log("never the worker's self-reported claim. In dry-run the hub can't re-verify, so it");
console.log("refuses to mark anything `completed` — worker prose is non-authoritative (I7).");
console.log("A live run (live=true) re-runs `pytest -q` in a fresh sandbox and trusts only that.");
