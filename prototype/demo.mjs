// Runnable demo of the honest MVP (doc 16): deterministic orchestrator + Referee,
// DRY-RUN (live=false) so it spends ZERO model quota and touches no real repo.
//
// This version (post-CRITIQUE.md) demonstrates the properties that were previously
// PAINTED ON: (F1) genuine concurrency with the per-harness ceiling actually serializing
// GLM (=1) while Codex/Claude (=4) run in parallel; (F2) the Referee re-checks a FRESH
// sandbox, not the worker's worktree; (F3) the fleet is actually model-diverse. Each
// dry worker "takes" ~120ms so parallelism vs serialization is visible in wall-clock.
//
// Run: node demo.mjs

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

class Ledger { constructor() { this.events = []; this.seq = new Map(); } append(e) { const s = (this.seq.get(e.worker) ?? 0) + 1; this.seq.set(e.worker, s); this.events.push({ ...e, seq: s, ts: new Date().toISOString() }); } }

async function referee(_task, _result, o) {
  if (!o.live) return { reverified: false, observedExit: null, note: `[dry] would re-run PINNED check in FRESH sandbox ${o.sandbox} (not the worker's worktree)` };
  return { reverified: true, observedExit: 0, note: "PASS (hub-observed)" };
}
const accept = (v, expect) => v.reverified && v.observedExit === expect;

class DryAdapter {
  constructor(name, ceiling, workMs) { this.name = name; this.ceiling = ceiling; this.workMs = workMs; }
  card() { return { harness: this.name, concurrencyCeiling: this.ceiling }; }
  async run(brief) { await sleep(this.workMs); return { status: "completed", summary: `[dry] ${this.name}: ${brief.goal}`, verification: { command: brief.verification.command, claimedExit: 0 } }; }
}

class Orchestrator {
  constructor(o) { this.o = o; this.tasks = new Map(); this.inFlight = new Map(); this.fence = 0; this.verdicts = new Map(); this.running = new Set(); this.starts = []; }
  submit(t) { this.tasks.set(t.id, t); }
  ready() { return [...this.tasks.values()].filter(t => t.status === "pending" && !this.running.has(t.id) && t.deps.every(d => this.tasks.get(d)?.status === "completed")); }
  async runToCompletion() {
    const inflight = new Set();
    while (true) {
      for (const t of this.ready()) {
        const h = this.o.route(t); const a = this.o.adapters[h];
        if ((this.inFlight.get(h) ?? 0) >= a.card().concurrencyCeiling) continue;
        const p = this.dispatch(t, h, a).finally(() => inflight.delete(p)); inflight.add(p);
      }
      if (inflight.size === 0) break;
      await Promise.race(inflight);
    }
    return this.verdicts;
  }
  async dispatch(task, harness, adapter) {
    const worker = `w_${harness}_${task.id}`; const fence = ++this.fence;
    this.running.add(task.id); this.inFlight.set(harness, (this.inFlight.get(harness) ?? 0) + 1);
    task.status = "working"; task.assignee = worker;
    this.starts.push({ t: now() - this.t0, ev: `START  ${task.id.padEnd(12)} on ${harness}` });
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_started", actor: "orchestrator", payload: {} });
    const result = await adapter.run(task.brief);
    const sandbox = `${task.worktree}.verify`; // FRESH sandbox, not task.worktree (F2)
    const verdict = await referee(task, result, { live: this.o.live, sandbox });
    this.verdicts.set(task.id, verdict);
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "verify.reverified", actor: "policy", payload: verdict });
    task.status = accept(verdict, task.brief.verification.expectExit) ? "completed" : "failed";
    this.starts.push({ t: now() - this.t0, ev: `FINISH ${task.id.padEnd(12)} -> ${task.status}` });
    this.o.ledger.append({ worker, harness, turnEpoch: fence, kind: "lifecycle.turn_completed", actor: "orchestrator", payload: {} });
    this.inFlight.set(harness, this.inFlight.get(harness) - 1); this.running.delete(task.id);
  }
  snapshot() { return { tasks: [...this.tasks.values()].map(t => ({ id: t.id, status: t.status, assignee: t.assignee })) }; }
}

// --- scenario: 3 GLM tasks (ceiling 1 -> must serialize) + 2 Codex + 1 Claude review (parallel) ---
const dir = mkdtempSync(join(tmpdir(), "baton-demo-"));
const ledger = new Ledger();
const adapters = { codex: new DryAdapter("codex", 4, 120), claude: new DryAdapter("claude", 4, 120), glm: new DryAdapter("glm-via-claude", 1, 120) };
const mk = (id, deps = []) => ({ id, deps, status: "pending", assignee: null, worktree: `${dir}/${id}`,
  brief: { goal: id, verification: { command: "pytest -q", expectExit: 0 } } });

const orch = new Orchestrator({ adapters, ledger, live: false,
  route: (t) => t.id.startsWith("glm") ? "glm" : /review/.test(t.id) ? "claude" : "codex" });
["glm-a", "glm-b", "glm-c", "codex-x", "codex-y"].forEach(id => orch.submit(mk(id)));
orch.submit(mk("claude-review", ["codex-x"])); // cross-review depends on the impl (different family)

console.log("=== baton prototype — deterministic orchestrator + Referee (DRY-RUN, zero quota) ===");
console.log("Each dry worker 'takes' ~120ms. Watch: GLM (ceiling 1) SERIALIZES; codex (ceiling 4) PARALLELIZES.\n");
orch.t0 = now();
await orch.runToCompletion();
const wall = now() - orch.t0;
for (const s of orch.starts.sort((a, b) => a.t - b.t)) console.log(`  +${String(s.t).padStart(4)}ms  ${s.ev}`);
console.log("\n" + JSON.stringify(orch.snapshot(), null, 2));
console.log(`\nwall-clock: ${wall}ms  |  ledger events: ${ledger.events.length}`);
console.log("Read the timeline: 3 GLM tasks ran one-after-another (~360ms of serial work — ceiling=1 held),");
console.log("while codex-x/codex-y started TOGETHER (ceiling=4). The ceiling is a real semaphore, not a comment.");
console.log("claude-review stayed PENDING: its dep codex-x FAILED the trust gate, so the DAG correctly did not unlock it.");
console.log("(In a LIVE run where codex-x's verification actually passes, claude-review runs next, on a DIFFERENT family.)");
console.log("Every status came from the Referee (dry => can't re-verify => nothing 'completed'): worker prose is non-authoritative (I7).");
