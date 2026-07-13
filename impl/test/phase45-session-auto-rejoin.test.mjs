import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator, MockAdapter, SessionRecoverySupervisor, createBrief, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-session-recovery-${name}-`));
const until = async (fn, label, timeoutMs = 5000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error(`timed out waiting for ${label}`); };
const brief = () => createBrief({ goal: 'write proof', constraints: [], pathScope: ['proof.txt'], definitionOfDone: 'proof exists', verification: { command: 'test -s proof.txt', expectExit: 0, timeoutMs: 5000 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } });
class ResumeMock extends MockAdapter {
  constructor(pid) { super({ card: { harness: 'resume-fixture', version: '1', concurrencyCeiling: 1 }, scenario: { outcome: 'completed', edits: [{ path: 'proof.txt', content: 'verified\n', delayMs: 20 }] } }); this.pid = pid; }
  card() { return { ...super.card(), sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' }, modelSelection: { mode: 'exact', configuredDefault: 'resume-fixture-model', available: ['resume-fixture-model'], family: 'resume-fixture', acceptedPrefixes: ['resume-fixture-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } }; }
  async spawn(worker, taskBrief, opts = {}) { const ack = await super.spawn(worker, taskBrief, opts); if (ack.ok) { const session = this._sessions.get(worker); this._emit(session, 'lifecycle.spawned', { sessionId: opts.session?.id ?? 'resume-native-1', pid: this.pid }); } return ack; }
}

function stub({ candidates = ['w-1', 'w-2'], outcomes = {} } = {}) {
  const calls = { begin: 0, candidates: 0, active: 0, maxActive: 0, recover: [], complete: [], kill: [] };
  const coordinator = {
    beginStartupRecovery(authority) { assert.ok(authority); calls.begin += 1; },
    startupRecoveryCandidates(authority, maxStateRows) { assert.ok(authority); assert.equal(maxStateRows, 8); calls.candidates += 1; return [...candidates]; },
    async recover(workerId, opts) { calls.active += 1; calls.maxActive = Math.max(calls.maxActive, calls.active); calls.recover.push({ workerId, opts }); await Promise.resolve(); calls.active -= 1; return outcomes[workerId] ?? { ok: true, result: 'attached' }; },
    completeStartupRecovery(authority, code = null) { assert.ok(authority); calls.complete.push(code); },
    async kill(workerId, actor, opts) { calls.kill.push({ workerId, actor, opts }); return { ok: true, result: 'confirmed' }; },
  };
  return { coordinator, calls };
}

test('SR1/SR3/SR5/SR6: one bounded sequential scan reports honest degraded results and starts once', async () => {
  const { coordinator, calls } = stub({ outcomes: { 'w-2': { ok: false, result: 'session_identity_mismatch' } } }); const authority = {}; const events = [];
  const supervisor = new SessionRecoverySupervisor({ coordinator, authority, policy: { maxSessions: 2, maxStateRows: 8, timeoutMs: 50 }, onEvent: (event) => events.push(event) });
  const first = supervisor.start(); const second = supervisor.start(); assert.equal(first, second); const summary = await first;
  assert.deepEqual(summary, { status: 'degraded', eligible: 2, attached: 1, failed: 1, skipped: 0, failures: [{ workerId: 'w-2', code: 'session_identity_mismatch' }] });
  assert.equal(calls.begin, 1); assert.equal(calls.candidates, 1); assert.equal(calls.maxActive, 1); assert.deepEqual(calls.recover.map((row) => row.workerId), ['w-1', 'w-2']); assert.ok(calls.recover.every((row) => row.opts.timeoutMs === 50 && row.opts.actor === 'policy:startup-recovery' && row.opts.startupAuthority === authority)); assert.deepEqual(calls.complete, [null]); assert.deepEqual(events.map((event) => event.kind), ['session.recovery_started', 'session.recovery_completed']);
  assert.equal(await supervisor.close(), true); assert.equal(await supervisor.close(), false); assert.deepEqual(calls.kill.map((row) => row.workerId), ['w-1']); assert.equal(calls.kill[0].opts.startupAuthority, authority); assert.equal(calls.kill[0].opts.emergency, true);
});

test('SR2/SR3: max plus one fails readiness without attempting a prefix', async () => {
  const { coordinator, calls } = stub(); const authority = {}; const supervisor = new SessionRecoverySupervisor({ coordinator, authority, policy: { maxSessions: 1, maxStateRows: 8, timeoutMs: 50 } });
  const summary = await supervisor.start(); assert.equal(summary.status, 'failed'); assert.equal(summary.failures[0].code, 'session_recovery_capacity'); assert.deepEqual(calls.recover, []); assert.deepEqual(calls.complete, ['session_recovery_capacity']); assert.equal(await supervisor.close(), true); assert.deepEqual(calls.kill, []);
});

test('SR5/SR7: close during a bounded attempt skips the suffix and reaps the attached prefix', async () => {
  const { coordinator, calls } = stub(); const authority = {}; let release; const gate = new Promise((resolve) => { release = resolve; }); coordinator.recover = async (workerId, opts) => { calls.recover.push({ workerId, opts }); await gate; return { ok: true, result: 'attached' }; };
  const supervisor = new SessionRecoverySupervisor({ coordinator, authority, policy: { maxSessions: 2, maxStateRows: 8, timeoutMs: 50 } }); const ready = supervisor.start(); await Promise.resolve(); const closing = supervisor.close(); release(); const summary = await ready; assert.deepEqual(summary, { status: 'ready', eligible: 2, attached: 1, failed: 0, skipped: 1, failures: [] }); assert.equal(await closing, true); assert.deepEqual(calls.recover.map((row) => row.workerId), ['w-1']); assert.deepEqual(calls.kill.map((row) => row.workerId), ['w-1']);
});

test('SR2/SR5: authoritative recovery-write loss fails readiness instead of degrading', async () => {
  const { coordinator, calls } = stub({ candidates: ['w-1'] }); const authority = {}; coordinator.recover = async () => { throw Object.assign(new Error('disk unavailable'), { code: 'coordination_write_unavailable' }); };
  const supervisor = new SessionRecoverySupervisor({ coordinator, authority, policy: { maxSessions: 1, maxStateRows: 8, timeoutMs: 50 } }); const summary = await supervisor.start(); assert.equal(summary.status, 'failed'); assert.deepEqual(summary.failures, [{ workerId: null, code: 'coordination_write_unavailable' }]); assert.deepEqual(calls.complete, ['coordination_write_unavailable']); assert.equal(await supervisor.close(), true);
});

test('SR2/SR3: Coordinator readiness barrier blocks ordinary authority but permits its private bounded scan', async () => {
  const authority = {}; const log = new Log(root('barrier-log')); const coordination = new CoordinationStore(root('barrier-coordination'));
  const coordinator = new Coordinator({ log, coordination, fences: new FenceTable(), adapters: {}, worktrees: { reconcile: async () => {} }, referee: async () => ({}), route: () => null, startupRecoveryAuthority: authority });
  coordinator.beginStartupRecovery(authority); assert.throws(() => coordinator.list(), (error) => error.code === 'session_recovery_pending'); assert.deepEqual(coordinator.startupRecoveryCandidates(authority, 1), []); assert.throws(() => coordinator.startupRecoveryCandidates({}, 1), (error) => error.code === 'session_recovery_authority'); coordinator.completeStartupRecovery(authority); assert.deepEqual(coordinator.list(), []); await coordinator.startupReady(); assert.equal(coordinator.closeAuthority(), true);
});

test('SR1/SR7/SR8: public driver validates opt-in policy, exposes readiness, and requires async close', async () => {
  const repoRoot = root('repo'); execFileSync('git', ['init', '-q'], { cwd: repoRoot }); execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repoRoot }); const logDir = root('driver-log');
  assert.throws(() => createDriver({ repoRoot, logDir: root('invalid-log'), adapters: {}, sessionRecoveryPolicy: { maxSessions: 1, maxStateRows: 1, timeoutMs: 0 } }), /session recovery policy/);
  const driver = createDriver({ repoRoot, logDir, adapters: {}, sessionRecoveryPolicy: { maxSessions: 2, maxStateRows: 8, timeoutMs: 50 } }); const summary = await driver.ready; assert.deepEqual(summary, { status: 'ready', eligible: 0, attached: 0, failed: 0, skipped: 0, failures: [] }); assert.equal(driver.sessionRecovery.status().status, 'ready'); assert.throws(() => driver.close(), (error) => error.code === 'driver_async_close_required'); assert.equal(await driver.closeAsync(), true); assert.equal(existsSync(join(logDir, 'coordination', 'writer.lease')), false);
  const plain = createDriver({ repoRoot, logDir: root('plain-log'), adapters: {} }); assert.equal(plain.sessionRecovery, null); assert.equal((await plain.ready).status, 'ready'); assert.equal(plain.close(), true);
});

test('SR2-SR8: public startup automatically reattaches one exact native session and close reaps it', async () => {
  const repoRoot = root('live-repo'); execFileSync('git', ['init', '-q'], { cwd: repoRoot }); execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repoRoot }); const logDir = root('live-log');
  const first = createDriver({ repoRoot, logDir, adapters: { fixture: new ResumeMock(101) } }); const handle = await first.coordinator.spawn('fixture', brief(), { taskId: 'auto-rejoin', taskType: 'implementation', model: 'resume-fixture-model', effort: 'low' }); await until(async () => (await first.coordinator.result(handle.id)).ready, 'first verified turn'); const firstHandle = first.coordinator.list()[0]; const firstContext = firstHandle.sessionContext; const firstRuntime = firstHandle.runtimeScope.root; assert.equal(firstHandle.sessionRef.id, 'resume-native-1'); assert.ok(existsSync(firstContext.worktree)); assert.ok(existsSync(firstRuntime));
  first.coordination.releaseWriterLease();
  const replay = createDriver({ repoRoot, logDir, adapters: { fixture: new ResumeMock(202) }, sessionRecoveryPolicy: { maxSessions: 2, maxStateRows: 8, timeoutMs: 500 } }); const readiness = await replay.ready; assert.deepEqual(readiness, { status: 'ready', eligible: 1, attached: 1, failed: 0, skipped: 0, failures: [] }); const attached = replay.coordinator.list()[0]; assert.equal(attached.sessionRef.id, 'resume-native-1'); assert.equal(attached.modelResolved, 'resume-fixture-model'); assert.equal(attached.effortResolved, 'low'); assert.equal(attached.runtimeScope.root, firstRuntime); await until(async () => (await replay.coordinator.result(handle.id)).ready, 'recovered verified refinement'); assert.equal(replay.coordination.snapshot().tasks.length, 2); assert.ok(replay.log.read(handle.id).some((event) => event.kind === 'control.recovery_attached'));
  assert.equal(await replay.closeAsync(), true); assert.equal(existsSync(join(logDir, 'coordination', 'writer.lease')), false); assert.equal(existsSync(firstContext.worktree), false); assert.equal(!existsSync(join(repoRoot, '.baton', 'runtime')) || readdirSync(join(repoRoot, '.baton', 'runtime')).length === 0, true); assert.equal(execFileSync('git', ['branch', '--list', 'baton/auto-rejoin'], { cwd: repoRoot, encoding: 'utf8' }).trim(), '');
});
