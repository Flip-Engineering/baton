import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { ProviderQuotaAuthority } from '../src/route-quota.mjs';

// #295 (items 2, 3, 5) and #265 item 2 — the death of a member whose provider refused its turn:
// the fault is typed, a transient one re-drives the turn in place BEFORE any kill, a quota one
// blocks its route and is never re-driven on it, every policy kill names the rule it applied, the
// death lands as a RUN-LEVEL attention row (route, fault class, reset instant, what was preserved,
// and the next act), the terminal cause is never null, a retained checkout is named with the
// reason its checkpoint could not be written, and every observed native child is settled.

const dirs = [];
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-provider-fault-'));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const RESET_AT = '2026-09-14T20:40:02.000Z';
const NOW = Date.parse('2026-09-14T20:00:00Z');

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    ...overrides,
  };
}

function failedTurn(failure) {
  return {
    status: 'failed',
    progress: 1,
    summary: 'the provider refused the turn',
    artifacts: { commits: [], files: [] },
    verification: { command: 'true', claimedExit: 1 },
    openQuestions: [],
    budgetUsed: { tokens: 1, usd: 0 },
    failure,
  };
}

class ScriptableAdapter {
  constructor({ autoConfirmKill = false } = {}) {
    this.autoConfirmKill = autoConfirmKill;
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000, verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', kill: 'native' },
      // The exact route this card resolves to — the tuple a governed deployment's policy is keyed
      // on, so an admission can name the model and effort it admitted.
      modelSelection: {
        mode: 'exact', family: 'mock', configuredDefault: 'mock-model', available: ['mock-model'],
        acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null,
      },
      // The governance block a GOVERNED deployment reads: the retry is admitted through the same
      // budget gate as any other new turn, and a governed turn seals its usage. Inert unless the
      // coordinator is constructed with a providerGovernance policy.
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'mock-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], kill: [] };
    this.acks = { spawn: { ok: true }, prompt: { ok: true }, interrupt: { ok: true }, kill: { ok: true } };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return this.acks.spawn; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return this.acks.prompt; }
  async interrupt(worker) { this.calls.interrupt.push({ worker }); return this.acks.interrupt; }
  async kill(worker) {
    this.calls.kill.push({ worker });
    // A harness that owns its own transport confirms the kill on its wire; the drain waits on that
    // confirmation, so the emulation must deliver it.
    if (this.autoConfirmKill) {
      queueMicrotask(() => this.emit({ worker, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} }));
    }
    return this.acks.kill;
  }
}

class PreservingWorktreeManager {
  constructor({ captureFails = false, root = tmpDir() } = {}) {
    this.captureFails = captureFails;
    this.root = root;
    this.calls = { create: [], capture: [], retainCheckpoint: [], resolveCheckpoint: [], remove: [] };
    this.checkpoint = { ref: 'refs/baton/checkpoints/pf-1', sha: 'a'.repeat(40) };
  }
  pathFor(taskId) { return join(this.root, `wt-${taskId}`); }
  async create(taskId) {
    this.calls.create.push(taskId);
    const path = this.pathFor(taskId);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'work.mjs'), '// the member produced this\n');
    return { path, branch: `baton/${taskId}`, baseSha: 'b'.repeat(40) };
  }
  async capture(worktreePath) {
    this.calls.capture.push(worktreePath);
    if (this.captureFails) {
      throw Object.assign(new Error('the checkout could not be captured'), { code: 'capture_failed' });
    }
    return { sha: this.checkpoint.sha, changedPaths: ['impl/src/x.mjs'] };
  }
  async retainCheckpoint(sha) { this.calls.retainCheckpoint.push(sha); return this.checkpoint.ref; }
  async resolveCheckpoint(ref) { this.calls.resolveCheckpoint.push(ref); return this.checkpoint.sha; }
  async createVerifyWorktree(taskId, sha) { return { path: `/tmp/verify/${taskId}-${sha}` }; }
  async removeVerifyWorktree() { /* noop */ }
  async remove(taskId) { this.calls.remove.push(taskId); rmSync(this.pathFor(taskId), { recursive: true, force: true }); }
  async reconcile() { return { errors: [], retained: [] }; }
  worktreeAvailable() { return true; }
}

const passingReferee = () => async (task) => ({
  reverified: true, observedExit: task.brief.verification.expectExit, matchesClaim: true,
  locus: 'fresh_sandbox', note: 'ok',
});

function setup(overrides = {}) {
  const log = new Log(join(tmpDir(), 'log'));
  const adapter = overrides.adapter ?? new ScriptableAdapter();
  const worktrees = overrides.worktrees ?? new PreservingWorktreeManager();
  const quota = overrides.quota ?? null;
  let clock = NOW;
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => clock,
    stopDeadlineMs: overrides.stopDeadlineMs ?? 5_000,
    ...(overrides.repoId ? { repoId: overrides.repoId } : {}),
    ...(overrides.drainPolicy ? { drainPolicy: overrides.drainPolicy } : {}),
    ...(quota ? { providerQuotaAuthority: quota } : {}),
    ...(overrides.providerGovernance ? { providerGovernance: overrides.providerGovernance } : {}),
  });
  return { log, adapter, worktrees, quota, coordinator, advance: (ms) => { clock += ms; } };
}

const workerRow = (coordinator, workerId) => coordinator.list().find((worker) => worker.id === workerId);

async function attentionReasons(coordinator, runId) {
  const page = await coordinator.attentionFollow(
    { scope: { runId }, afterCursor: 0 },
    { principalId: 'wave-owner', sessionId: 'session-wave-owner' },
  );
  return page?.reasons ?? page?.wakes ?? [];
}

const emitTurn = (adapter, handle, failure, turnEpoch = 1) => adapter.emit({
  worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
  payload: failedTurn(failure),
});

const emitKillConfirmed = (adapter, handle) => adapter.emit({
  worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1,
  kind: 'kill.confirmed', actor: 'worker', payload: {},
});

const transient = (adapter, handle, turnEpoch = 1) => emitTurn(adapter, handle, {
  code: 'provider_socket_closed', message: 'The socket connection was closed unexpectedly',
  detail: { route: ROUTE, resetAt: null },
}, turnEpoch);

const quota = (adapter, handle) => emitTurn(adapter, handle, {
  code: 'provider_quota_exhausted', message: '429 usage limit reached',
  detail: { route: ROUTE, resetAt: RESET_AT, statusCode: 429 },
});

// A governed deployment: one exact route with a terminal reserve the member's declared budget must
// keep clear. `terminalReserve` is the only difference between the admitted and the refused case.
const governedPolicy = (terminalReserve) => ({
  schemaVersion: 1, maxWireFrameBytes: 1024 * 1024, maxProviderCallsPerTurn: 4, maxToolCallsPerTurn: 4,
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low', terminalReserve, mode: 'observe' }],
});

// A governed member's usage observation and the seal its failed turn must carry (the governed turn
// contract: an unsealed turn is refused before the provider-failure path is reached).
const SEAL = Object.freeze({ tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'mock-total' });
const governedUsage = (adapter, handle, { tokens = 20, usd = 0.2 } = {}) => adapter.emit({
  worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'resource.tokens', actor: 'worker',
  payload: { source: 'mock', counterId: 'turn-1', accounting: 'delta', tokens, usd, tokenMetric: 'mock-total' },
});
const governedTransient = (adapter, handle) => adapter.emit({
  worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
  payload: {
    ...failedTurn({
      code: 'provider_socket_closed', message: 'The socket connection was closed unexpectedly',
      detail: { route: ROUTE, resetAt: null },
    }),
    usageSeal: { ...SEAL },
  },
});

test('#295-2: a transient transport fault re-drives the turn on the same session before any kill', async () => {
  const { coordinator, adapter, log, worktrees } = setup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-retry' });
  const worktreePath = workerRow(coordinator, handle.id).worktree;

  transient(adapter, handle);
  await coordinator.wait(50);

  assert.equal(adapter.calls.prompt.length, 1,
    'the dropped connection re-drove the turn as a NEW turn on the same session');
  assert.equal(adapter.calls.prompt[0].mode, 'turn');
  assert.equal(adapter.calls.kill.length, 0, 'no kill was requested for a transient fault');
  const retry = log.read(handle.id).filter((event) => event.kind === 'provider.transient_retry');
  assert.equal(retry.length, 1, 'the retry is durable evidence, not an invisible re-prompt');
  assert.equal(retry[0].payload.action, 'new_turn_on_same_session');
  assert.equal(retry[0].payload.attempt, 1);
  assert.equal(Object.hasOwn(retry[0].payload, 'of'), false,
    'no retry ceiling rides the row — the re-drive has no count (#574)');
  assert.deepEqual(retry[0].payload.route, ROUTE);
  assert.equal(workerRow(coordinator, handle.id).status, 'working', 'the member keeps working');
  assert.equal(worktrees.calls.create.length, 1, 'the retry reuses the SAME checkout — no second worktree');
  assert.equal(worktrees.calls.remove.length, 0);
  assert.equal(workerRow(coordinator, handle.id).worktree, worktreePath,
    'and the member keeps working in the checkout it already owns');
  assert.equal(adapter.calls.prompt[0].worker, handle.id, 'the re-driven turn is on the SAME session');
  assert.equal(log.read(handle.id).some((event) => event.kind === 'kill.requested'), false);
});

test('#295-2: a second transient fault re-drives again — the re-drive carries no retry count (#574)', async () => {
  const { coordinator, adapter, log } = setup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-retry-twice' });

  transient(adapter, handle, 1);
  await coordinator.wait(50);
  transient(adapter, handle, 2);
  await coordinator.wait(50);

  assert.equal(adapter.calls.prompt.length, 2,
    'each dropped connection earns a fresh turn on the same session; no count stops the re-drive');
  const retries = log.read(handle.id).filter((event) => event.kind === 'provider.transient_retry');
  assert.deepEqual(retries.map((event) => event.payload.attempt), [1, 2],
    'each re-drive is durable evidence and names the attempt it is');
  assert.equal(adapter.calls.kill.length, 0, 'the member keeps working while its budget admits turns');
  assert.equal(workerRow(coordinator, handle.id).status, 'working');
});

test('#295-2: a transient retry rides the member\'s declared turn budget — it is admitted by the same gate as any new provider turn', async () => {
  const GOVERNANCE = governedPolicy({ tokens: 80, usd: 1 });
  const { coordinator, adapter, log } = setup({ providerGovernance: GOVERNANCE });
  const brief = makeBrief({ budget: { tokens: 100, usd: 2, wallMin: 30 } });
  const handle = await coordinator.spawn('mock', brief, { runId: 'run:pf-retry-budget' });
  governedUsage(adapter, handle);
  await coordinator.wait(10);

  governedTransient(adapter, handle);
  await coordinator.wait(50);

  const admitted = log.read(handle.id).filter((event) => event.kind === 'resource.provider_turn_admitted');
  assert.equal(admitted.length, 2,
    'the spawn turn AND the re-driven turn are both admitted — the retry does not bypass the gate');
  assert.equal(admitted.at(-1).payload.phase, 'transient_retry');
  assert.deepEqual(admitted.at(-1).payload.reserve, { tokens: 80, usd: 1 },
    'the member\'s own terminal reserve is what the re-driven turn is admitted against');
  assert.equal(adapter.calls.prompt.length, 1, 'and the admitted retry really started a turn');
});

test('#295-2: a re-driven turn the adapter refuses releases its admission and claims no retry', async () => {
  // The retry was admitted by the budget gate, but the adapter refused the prompt: the admission
  // is RELEASED by name and no `provider.transient_retry` row claims a turn that never started.
  const GOVERNANCE = governedPolicy({ tokens: 80, usd: 1 });
  const adapter = new ScriptableAdapter();
  adapter.acks.prompt = { ok: false, reason: 'prompt_refused' };
  const { coordinator, log } = setup({ adapter, providerGovernance: GOVERNANCE });
  const brief = makeBrief({ budget: { tokens: 100, usd: 2, wallMin: 30 } });
  const handle = await coordinator.spawn('mock', brief, { runId: 'run:pf-retry-unstarted' });
  governedUsage(adapter, handle);
  await coordinator.wait(10);

  governedTransient(adapter, handle);
  await coordinator.wait(50);

  const events = log.read(handle.id);
  const admitted = events.filter((event) => event.kind === 'resource.provider_turn_admitted').at(-1);
  const released = events.find((event) => event.kind === 'resource.provider_turn_released');
  assert.ok(released, 'the admitted-but-unstarted turn is released, not left open');
  assert.equal(released.payload.code, 'transient_retry_refused');
  assert.equal(released.payload.admissionSeq, admitted.payload.admissionSeq ?? admitted.seq);
  assert.equal(events.filter((event) => event.kind === 'provider.transient_retry').length, 0,
    'no retry is claimed for a turn the provider never started');
  const kill = events.find((event) => event.kind === 'kill.requested');
  assert.equal(kill.payload.rule, 'provider_fault', 'and the member is settled by the ordinary path');
});

test('#295-2: a member with no budget left for another provider turn is settled, never re-driven', async () => {
  // The reserve the member must keep clear (90) exceeds what is left after its first turn (80) of a
  // 100-token budget: the re-driven turn is REFUSED by the existing admission gate, so the ordinary
  // provider-failure settlement owns the death instead of a retry spending past the declared budget.
  const GOVERNANCE = governedPolicy({ tokens: 90, usd: 1 });
  const { coordinator, adapter, log } = setup({ providerGovernance: GOVERNANCE });
  const brief = makeBrief({ budget: { tokens: 100, usd: 2, wallMin: 30 } });
  const handle = await coordinator.spawn('mock', brief, { runId: 'run:pf-retry-refused' });
  governedUsage(adapter, handle);
  await coordinator.wait(10);

  governedTransient(adapter, handle);
  await coordinator.wait(50);

  assert.equal(adapter.calls.prompt.length, 0, 'no provider turn was started past the budget');
  const refused = log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused');
  assert.ok(refused, 'the refusal is durable evidence with its own code');
  assert.equal(refused.payload.phase, 'transient_retry');
  assert.equal(refused.payload.code, 'token_reserve_unavailable');
  assert.equal(log.read(handle.id).filter((event) => event.kind === 'provider.transient_retry').length, 0,
    'a retry that never happened is never claimed');
  const kill = log.read(handle.id).find((event) => event.kind === 'kill.requested');
  assert.equal(kill.payload.rule, 'provider_fault', 'the member is settled by the ordinary path');
});

test('#295-3: a quota death that arrives as a dead transport still names its class, route and reset', async () => {
  // The observed shape (a): the provider answers 429, the participant dies as an ANONYMOUS runtime.
  // The adapter types the crash cert; the death row, the terminal cause and the route block all
  // carry the same class and the same reset instant the provider itself recorded.
  const quotaAuthority = new ProviderQuotaAuthority({ now: () => NOW });
  const { coordinator, adapter, log } = setup({ quota: quotaAuthority });
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-crash-quota' });

  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    payload: {
      phase: 'process_exit', exitCode: 143, signal: null,
      code: 'provider_quota_exhausted', error: '429 Usage limit reached, will reset at 2026-09-14 20:40:02',
      detail: { route: ROUTE, resetAt: RESET_AT, statusCode: 429 },
    },
  });
  await coordinator.wait(20);
  const stopped = coordinator.kill(handle.id, 'policy');
  emitKillConfirmed(adapter, handle);
  await stopped;
  await coordinator.wait(20);

  const cause = (await coordinator.result(handle.id)).terminalCause;
  assert.equal(cause.kind, 'provider_failure');
  assert.equal(cause.code, 'provider_quota_exhausted', 'the dead runtime is typed, never anonymous');
  assert.equal(cause.detail.resetAt, RESET_AT, 'the crash cert\'s reset instant is not dropped');
  assert.deepEqual(cause.detail.route, ROUTE);

  const block = quotaAuthority.blockFor(ROUTE);
  assert.equal(block.resetAt, RESET_AT, 'a quota death blocks its route however the transport died');

  const rows = (await attentionReasons(coordinator, 'run:pf-crash-quota'))
    .filter((reason) => reason.kind === 'provider_fault_death');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].route, ROUTE);
  assert.equal(rows[0].fault.code, 'provider_quota_exhausted');
  assert.equal(rows[0].fault.resetAt, RESET_AT);
  assert.equal(rows[0].next.action, 'wait_until_reset');
  assert.equal(rows[0].next.notBefore, RESET_AT);
  assert.equal(log.read(handle.id).some((event) => event.kind === 'provider.quota_exhausted'), true,
    'the durable route block rides the evidence lane too');
});

test('#295-2/#295-4: a quota fault is never re-driven on the same route, blocks the route, and names the reset', async () => {
  const quotaAuthority = new ProviderQuotaAuthority({ now: () => NOW });
  const { coordinator, adapter, log } = setup({ quota: quotaAuthority });
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-quota' });

  quota(adapter, handle);
  await coordinator.wait(50);

  assert.equal(adapter.calls.prompt.length, 0, 'a spent quota is not re-driven on the same route');
  const block = quotaAuthority.blockFor(ROUTE);
  assert.equal(block.code, 'provider_quota_exhausted');
  assert.equal(block.resetAt, RESET_AT,
    'the route is blocked until the reset instant the provider itself recorded');
  assert.equal(quotaAuthority.blockFor(ROUTE, Date.parse('2026-09-14T20:40:03Z')), null,
    'readiness returns by DERIVATION from the recorded instant — no polling constant');
  const row = log.read(handle.id).find((event) => event.kind === 'provider.quota_exhausted');
  assert.equal(row.payload.action, 'block_route_until_reset');
  assert.equal(row.payload.recordedByReadiness, true, 'the deployment readiness authority saw the block');
});

test('#295-3: the death lands as a run-level attention row and a terminal cause that is never null', async () => {
  const quotaAuthority = new ProviderQuotaAuthority({ now: () => NOW });
  const { coordinator, adapter, log } = setup({ quota: quotaAuthority });
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-row' });

  quota(adapter, handle);
  await coordinator.wait(20);
  const stopped = coordinator.kill(handle.id, 'policy');
  emitKillConfirmed(adapter, handle);
  await stopped;
  await coordinator.wait(20);

  const kill = log.read(handle.id).find((event) => event.kind === 'kill.requested');
  assert.equal(kill.payload.rule, 'provider_fault');

  const cause = (await coordinator.result(handle.id)).terminalCause;
  assert.ok(cause, 'run.view terminal cause is never null for a typed death');
  assert.equal(cause.kind, 'provider_failure');
  assert.equal(cause.code, 'provider_quota_exhausted');
  assert.equal(cause.detail.resetAt, RESET_AT);
  assert.deepEqual(cause.detail.route, ROUTE);

  const rows = (await attentionReasons(coordinator, 'run:pf-row'))
    .filter((reason) => reason.kind === 'provider_fault_death');
  assert.equal(rows.length, 1, 'exactly one run-level row per death');
  const row = rows[0];
  assert.deepEqual(row.route, ROUTE, 'the row names the exact route');
  assert.equal(row.fault.code, 'provider_quota_exhausted', 'the row names the fault class');
  assert.equal(row.fault.resetAt, RESET_AT, 'and the reset instant when the provider named one');
  assert.equal(row.next.action, 'wait_until_reset');
  assert.equal(row.next.notBefore, RESET_AT);
  assert.equal(row.next.then, 'resume_from_checkpoint');
  assert.equal(row.checkpoint.sha, 'a'.repeat(40), 'the pinned progress checkpoint rides the row');
  assert.equal(row.workerId, handle.id);
  assert.equal(row.taskId, handle.taskId);
});

test('#295-5: preservation failure names the retained checkout and the reason, and the row keeps it after death', async () => {
  const worktrees = new PreservingWorktreeManager({ captureFails: true });
  const quotaAuthority = new ProviderQuotaAuthority({ now: () => NOW });
  const { coordinator, adapter, log } = setup({ worktrees, quota: quotaAuthority });
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-retain' });
  const worktreePath = workerRow(coordinator, handle.id).worktree;

  quota(adapter, handle);
  await coordinator.wait(20);
  const stopped = coordinator.kill(handle.id, 'policy');
  emitKillConfirmed(adapter, handle);
  await stopped;
  await coordinator.wait(20);

  const failed = log.read(handle.id).find((event) => event.kind === 'worktree.progress_preservation_failed');
  assert.ok(failed, 'the preservation failure is durable');
  assert.equal(failed.payload.action, 'retain_worktree');
  assert.equal(failed.payload.worktreePath, worktreePath,
    'the retained checkout is NAMED — the work is never an unnamed directory');
  assert.match(String(failed.payload.reason), /capture/u,
    'and so is the reason the checkpoint could not be written');

  const rows = (await attentionReasons(coordinator, 'run:pf-retain'))
    .filter((reason) => reason.kind === 'provider_fault_death');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].retainedWorktree, worktreePath);
  assert.match(String(rows[0].preservationFailure?.reason ?? ''), /capture/u);
  assert.equal(rows[0].next.action, 'wait_until_reset');
  assert.equal(rows[0].next.then, 'recover_retained_worktree',
    'the next act names the retained checkout when no checkpoint could be written');
  assert.equal(rows[0].next.worktreePath, worktreePath);

  const row = workerRow(coordinator, handle.id);
  assert.equal(row.status, 'dead');
  assert.equal(row.worktree, worktreePath, 'the participant keeps its checkout on its row after death');
  assert.equal(row.preservationFailure.worktreePath, worktreePath);
  assert.equal(row.preservationFailure.code, 'capture_failed');
});

test('#265-2: killing the parent settles every observed native child with a named gap', async () => {
  const { coordinator, adapter, log } = setup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-children' });
  log.append({
    worker: handle.id, harness: 'omp@17.4.0', turnEpoch: 1, actor: 'worker',
    kind: 'native.subagent_observed',
    payload: {
      harness: 'omp', nativeFrameType: 'subagent_lifecycle', phase: 'started', status: 'started',
      childSessionFile: '/tmp/child-session.jsonl', parentToolCallId: 'tool-1',
      parentWorker: handle.id, invocationKey: '["omp","w","s","tool-1"]',
    },
  });
  assert.equal(coordinator.workerActivity(handle.id).nativeSubagents.live, 1,
    'the child reads live while it is only observed');

  const stopped = coordinator.kill(handle.id, 'policy');
  emitKillConfirmed(adapter, handle);
  const outcome = await stopped;
  await coordinator.wait(20);
  assert.ok(['confirmed', 'already_dead'].includes(outcome.result), 'the stop converges');

  const settled = log.read(handle.id).filter((event) => event.kind === 'native.children_settled');
  assert.equal(settled.length, 1, 'the parent kill settles the observed child durably');
  assert.equal(settled[0].payload.gap, 'parent_stopped_before_child_terminal');
  assert.equal(settled[0].payload.count, 1);
  assert.equal(settled[0].payload.processGroupReaped, true);
  assert.equal(coordinator.workerActivity(handle.id).nativeSubagents.live, 0,
    'a settled child never reads live again — the stop cannot wait on a frame that cannot arrive');
  const row = workerRow(coordinator, handle.id);
  assert.equal(row.nativeChildSettlement.count, 1);
  assert.equal(row.nativeChildSettlement.gap, 'parent_stopped_before_child_terminal');
});

test('#265-2: a participant holding an observed native child still drains the run within its deadline', async () => {
  // The observed shape: a member that had spawned a native child kept reading "one child live"
  // forever after its parent was stopped, so the run stop never converged. The kill settles the
  // child it observed, and the fleet drain then reaches its deadline-free receipt.
  const adapter = new ScriptableAdapter({ autoConfirmKill: true });
  const { coordinator, log } = setup({
    adapter, repoId: 'repo-pf-drain',
    drainPolicy: { maxWorkers: 4, timeoutMs: 5_000, pollMs: 5 },
  });
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-drain' });
  log.append({
    worker: handle.id, harness: 'omp@17.4.0', turnEpoch: 1, actor: 'worker',
    kind: 'native.subagent_observed',
    payload: {
      harness: 'omp', nativeFrameType: 'subagent_lifecycle', phase: 'started', status: 'started',
      childSessionFile: '/tmp/child-session.jsonl', parentToolCallId: 'tool-2',
      parentWorker: handle.id, invocationKey: '["omp","w","s","tool-2"]',
    },
  });
  assert.equal(coordinator.workerActivity(handle.id).nativeSubagents.live, 1);

  const receipt = await coordinator.drain({
    repoId: 'repo-pf-drain', actor: 'operator', idempotencyKey: 'drain:pf-child',
  });

  assert.equal(receipt.state, 'drained', 'the drain converged instead of waiting out its deadline');
  assert.equal(receipt.remainingCount, 0);
  assert.equal(receipt.counts.killConfirmed, 1, 'the parent was confirmed dead exactly once');
  assert.equal(coordinator.workerActivity(handle.id).nativeSubagents.live, 0,
    'the settled child no longer holds the stop open');
  assert.equal(log.read(handle.id).filter((event) => event.kind === 'native.children_settled').length, 1);
});

test('#295-2: an operator stop names its own rule, distinct from a policy fault kill', async () => {
  const { coordinator, adapter, log } = setup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-rules' });
  const stopped = coordinator.kill(handle.id, 'operator');
  emitKillConfirmed(adapter, handle);
  await stopped;
  const kill = log.read(handle.id).find((event) => event.kind === 'kill.requested');
  assert.equal(kill.payload.rule, 'stop_requested');
  assert.equal(kill.payload.actor, 'operator');
});


test('#265-3: a stop deadline drives the survivor cleanup instead of abandoning it', async () => {
  const { coordinator, adapter, log, worktrees, advance } = setup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:pf-deadline' });
  const worktreePath = workerRow(coordinator, handle.id).worktree;

  // The transport reports its own exact close before the deadline wins: that correlated fact is
  // what makes the checkout safe to reap (an UNCONFIRMED process retains it instead).
  const pid = 5_151_515;
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_started', actor: 'worker',
    payload: { schemaVersion: 1, generation: 1, pid, processGroupId: pid, phase: 'initializing' },
  });
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_closed', actor: 'worker',
    payload: { schemaVersion: 1, generation: 1, pid, processGroupId: pid, ready: false, code: 0, signal: null },
  });
  assert.equal(coordinator._workers.get(handle.id).processRef.state, 'closed',
    'the exact close is the authority the deadline acts on');

  const stopped = coordinator.kill(handle.id, 'policy');
  await coordinator.wait(10);
  // No kill.confirmed ever arrives: the deadline is what ends the stop.
  advance(6_000);
  coordinator.tick();
  const outcome = await stopped;
  await coordinator.wait(80);

  assert.equal(outcome.result, 'forced', 'the deadline settles the stop');
  const deadlineRow = log.read(handle.id).find((event) => event.kind === 'control.stop_deadline_cleanup');
  assert.ok(deadlineRow, 'the deadline records what it did with the cleanup');
  assert.equal(deadlineRow.payload.action, 'reap_after_deadline');
  assert.equal(deadlineRow.payload.rule, 'stop_deadline');

  const preserved = log.read(handle.id).find((event) => event.kind === 'worktree.progress_checkpointed');
  assert.ok(preserved, 'the work is preserved BEFORE the checkout is reaped');
  assert.equal(preserved.payload.checkpoint.sha, 'a'.repeat(40));
  assert.ok(worktrees.calls.remove.includes(handle.taskId), 'and the checkout is actually released');

  const finished = coordinator._workers.get(handle.id);
  assert.equal(finished.status, 'dead');
  assert.deepEqual(Object.keys(coordinator._localResourceOwnership(finished)), [],
    'the deadline leaves no local-resource hold behind — the cleanup is not abandoned');
  assert.equal(workerRow(coordinator, handle.id).worktree, null);
  assert.equal(worktreePath, worktrees.pathFor(handle.taskId), 'the checkout this member worked in');
});