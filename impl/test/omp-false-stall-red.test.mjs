import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { RouteLiveness } from '../src/route-liveness.mjs';
import { createDriver } from '../src/index.mjs';

// #230 follow-on — the omp false-stall murder, root-caused from the wave-d fleet's durable
// logs (.git/baton/application-v3/state/w-636.jsonl, 2026-08-15):
//
//   14:56:06 lifecycle.spawned / lifecycle.turn_started (BOTH actor:orchestrator — the dispatch
//           rows, coordinator.mjs:3757/3830) … then ZERO worker-actor events ever again.
//   15:01:22 message.delivered (the messageOnSpawn nudge rode omp's steer-queue — emits nothing)
//   15:20:00 health.stall_suspected {basis:'no_progress_evidence', action:'escalate'}
//   15:35:26 kill.requested (owner, surfaced by the false stall_declared attention)
//   …while the member's OWN omp transcript shows 125 events and a bash tool call in flight
//   (session_exit reason:sigterm, pendingToolCalls:[bash]).
//
// The mechanism: the deployment wires the coordinator onto the adapter's single-slot onEvent
// (coordinator.mjs:1244-1286), then constructs RouteLiveness, whose _wrapAdapters re-wraps that
// slot by capturing the prior listener through PRIVATE FIELD SPELLINGS
// (route-liveness.mjs:90: `adapter._userCb ?? adapter._cb ?? adapter._onEvent`). OmpRpcCli
// stored its listener as `_callback` — no spelling matched, `prior` was null, and the wrapper
// REPLACED the coordinator's listener. Every omp worker event — including the first turn's
// lifecycle.turn_started — was silently dropped, handle.turnInFlight was never set
// (coordinator.mjs:9724), the D2 control-law line (coordinator.mjs:9144: a turn in flight
// re-arms instead of declaring) read false, and the stall watchdog murdered a working member
// on evidence that was false. Claude/grok/codex members survived only because their adapters
// happen to spell the field `_cb`.
//
// RED   = the RouteLiveness wrap orphans the omp adapter's coordinator lane; a live,
//         tool-calling turn is declared stalled (health.stall_suspected) while it works.
// GREEN = the coordinator keeps receiving omp events across the liveness wrap: the first turn
//         sets handle.turnInFlight, D2 re-arms through every stall window (no stall fires),
//         and the classifier stays HONEST — once the turn genuinely ends, a silent worker
//         still stalls. No termination semantics are weakened; the evidence simply becomes true.

const line = (frame) => `${JSON.stringify(frame)}\n`;

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-omp-false-stall',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const auth = (principalId, powers, idempotencyKey) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
  repoId: 'repo-omp-false-stall', runId: null, idempotencyKey,
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, requiredPredecessorEvidence: [],
});

async function until(fn, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

test('OMP-FALSE-STALL: a live omp turn (steer-nudged, mid-tool-call) is never declared stalled', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'baton-omp-false-stall-repo-'));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-omp-false-stall-log-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'l@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'L'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // The fake omp child (omp-rpc-red's shape): answers the ready handshake, acks the correlated
  // prompt command exactly as a real `omp --mode rpc` child, keeps its stdout lane open for
  // streamed provider-traffic frames, and reports exit when killed so drains converge.
  let childStdout = null;
  let promptSent = false;
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.pid = 424242;
      this.killed = false;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.stdin = {
        write: (chunk) => {
          let frame = null;
          try { frame = JSON.parse(chunk); } catch { frame = null; }
          if (frame?.type === 'prompt' && typeof frame.id === 'string') {
            promptSent = true;
            this.stdout.write(line({ type: 'response', id: frame.id, success: true }));
          }
        },
        end: () => {},
      };
    }
    kill(signal) {
      this.killed = signal ?? true;
      setImmediate(() => this.emit('exit', 0, signal ?? null));
    }
  }
  const spawnFn = () => {
    const child = new FakeChild();
    childStdout = child.stdout;
    setImmediate(() => { child.stdout.write(line({ type: 'ready', protocolVersion: 1 })); });
    return child;
  };
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    model: 'deepseek/deepseek-v4-flash',
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn,
  });

  const STALL_MS = 1_500;
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-omp-false-stall', logDir, adapters: { omp: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 1_000,
    drainPolicy: { maxWorkers: 4, timeoutMs: 10_000, pollMs: 10 },
    watchdog: { stallMs: STALL_MS, stallAction: 'escalate' },
  });

  // The deployment order that armed the murder weapon: RouteLiveness wraps the adapter's
  // single-slot listener AFTER the coordinator registered (application-deployment.mjs:2048).
  const liveness = new RouteLiveness({
    adapters: { omp: adapter }, coordinator: driver.coordinator,
    coordination: driver.coordination, log: driver.log, now: Date.now,
  });
  assert.equal(typeof liveness.now, 'function', 'the liveness controller constructed (the wrap ran)');

  const goalResult = await driver.coordinator.defineGoal({
    objective: 'Pin the omp false-stall murder', definitionOfDone: ['true passes'],
    constraints: [], risk: 'low', budget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 }, predecessor: null,
  }, auth('goal-owner', ['goal:define'], 'goal:false-stall'));
  const goal = goalResult.goal;
  const planResult = await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Pin the omp false-stall murder',
      definitionOfDone: ['true passes'], deps: [], pathScope: ['impl/**'], risk: 'low',
      budget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 }, verification,
      routes: { harnesses: ['omp'], models: ['deepseek/deepseek-v4-flash'], efforts: ['high'] },
      capabilities: ['code'], effects: ['repository_edit'],
    }],
  }, auth('planner', ['plan:propose'], 'plan:false-stall'));
  const plan = planResult.plan;
  await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], 'approval:false-stall'));

  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code'], effects: ['repository_edit'],
  };
  const brief = {
    goal: 'Pin the omp false-stall murder', constraints: [], pathScope: ['impl/**'],
    tools: [], outputFormat: '', definitionOfDone: 'true passes', verification,
    budget: { tokens: 4_000, usd: 1, wallMin: 5 }, providerTurns: 4,
    capabilities: ['code'], effects: ['repository_edit'],
  };
  const handle = await driver.coordinator.spawn('omp', brief, {
    taskId: 'omp-false-stall', model: 'deepseek/deepseek-v4-flash', effort: 'high', goalPlan: gate,
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'spawn:omp-false-stall',
  });

  const workerLog = () => driver.log.read(handle.id);
  const rawHandle = () => driver.coordinator._workers.get(handle.id);

  // (1) The murder-scene replay: the member WORKS — the first turn rides spawn (#230), provider
  // text streams, a tool call runs — exactly like w-636's live transcript. Then the
  // messageOnSpawn-style nudge rides the steer-queue (omp prompt() with an active turn queues
  // and emits nothing), and the stall window (1.5s here; 20 min in the fleet) elapses several
  // times over while the turn is STILL LIVE.
  await until(() => promptSent);
  childStdout.write(line({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'working ' } }));
  childStdout.write(line({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash' }));
  const nudgeAck = await adapter.prompt(handle.id, '[MESSAGE brief — UNTRUSTED] keep going', 'nudge');
  assert.equal(nudgeAck.ok, true, 'the mid-turn nudge steer-queues (the fleet shape)');

  await new Promise((resolve) => setTimeout(resolve, 4 * STALL_MS)); // ~2.7 stall windows, turn still live

  const stalled = workerLog().filter((event) => event.kind === 'health.stall_suspected');
  assert.equal(stalled.length, 0,
    `a live, tool-calling turn is NOT a stall — D2 must re-arm, never declare (got ${JSON.stringify(stalled.map((e) => e.payload))})`);

  // (2) The deafness pin: the coordinator's durable log must carry the adapter's WORKER-actor
  // events (first-turn turn_started, the #235 transport-liveness baseline). In the fleet these
  // were absent for every omp member — the coordinator was deaf to its own worker.
  await until(() => rawHandle()?.turnInFlight === true);
  await until(() => workerLog().some((event) => event.kind === 'lifecycle.transport_liveness'));
  assert.ok(workerLog().some((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker'),
    'the adapter\'s first-turn turn_started reaches the coordinator\'s durable log');
  assert.equal(rawHandle()?.turnInFlight, true, 'the handle still mirrors the in-flight turn');

  // (3) The turn-terminal seam stays truthful: a terminal agent_end completes the turn — the
  // coordinator SEES it (worker-actor turn_completed in the durable log), mirrors
  // turnInFlight:false, and CLEARS the watchdog (C4: the zombie-flag mirror-image — an idle
  // worker is never watched; the stall guards the WORKING period, where the in-flight turn is
  // the liveness truth). The fix changed the EVIDENCE, not the law.
  childStdout.write(line({ type: 'agent_end', isTerminal: true, messages: [] }));
  await until(() => workerLog().some((event) => event.kind === 'lifecycle.turn_completed' && event.actor === 'worker'));
  assert.equal(rawHandle()?.turnInFlight, false,
    'the turn-terminal seam clears the liveness marker — a completed turn may arm honestly again');
  const stallsAfterCompletion = workerLog().filter((event) => event.kind === 'health.stall_suspected');
  assert.equal(stallsAfterCompletion.length, 0,
    'no stall is minted for a turn that completed cleanly — the classifier fires on false silence, never on clean terminality');

  await driver.coordinator.kill(handle.id, 'test');
  await driver.drainAndClose('test');
});
