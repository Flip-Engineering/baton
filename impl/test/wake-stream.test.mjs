// Issue #294: the deployment-scope wake stream.
//
// ONE attachment to a resident receives the wake rows of EVERY swarm it hosts — including swarms
// created after the attachment — plus the deployment rows no swarm owns. These tests exercise the
// stream over a real resident (owner-only Unix socket, real principal, real coordination ledger)
// and the closed wake-class table that the filter, the CLI help and the docs all read.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import {
  WAKE_CLASS_TABLE, WAKE_CLASSES, deriveWakeFrame, openWakeStream, parseWakeFilter, wakeClassFor,
  wakeClassHelpLines, wakeClassTableRows,
} from '../src/wake-stream.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
// The deployment fixture is the repository's own: a mock adapter under an explicit route, so no
// provider credential is consulted and no real model is called.
function repository(t) {
  const root = mkdtempSync('/tmp/bt-wakes-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'wakes@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Wakes'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'wakes fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'wakes', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t, { capacity = null } = {}) {
  const deploymentRoot = mkdtempSync('/tmp/bt-wakes-deployment-');
  const configRoot = mkdtempSync('/tmp/bt-wakes-config-');
  const home = mkdtempSync('/tmp/bt-wakes-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: {
      deploymentRoot, adapters: { codex: adapter() }, routes: [ROUTE],
      ...(capacity === null ? {} : { capacity }),
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
    env, home,
  };
}

/** Attach to the resident's own published endpoint, exactly as an external consumer does. */
function attach(repo, configured, { filter = {}, onFrame, onError = null, resume = null, errors = [] }) {
  const connection = discoverBatonConnection({ cwd: repo, env: configured.env, home: configured.home });
  return openWakeStream({
    baseUrl: connection.baseUrl, socketPath: connection.socketPath ?? null,
    token: connection.token, origin: connection.origin, filter, resume,
    onFrame,
    onError: (error) => { errors.push(`${error?.code ?? 'error'}: ${error?.message ?? error}`); onError?.(error); },
  });
}

/** Wait until `predicate` holds, or fail with the wakes that did arrive. */
async function until(predicate, frames, label, timeoutMs = 30_000, errors = []) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`${label}: ${frames.length} wake(s): ${JSON.stringify(frames.map((frame) => [frame.wakeClass, frame.seq, frame.swarmId]))}; errors: ${JSON.stringify(errors)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ── the closed wake-class table ─────────────────────────────────────────────────────────────────

test('the wake-class table derives every class from its own ledger row, and admits nothing else', () => {
  assert.ok(WAKE_CLASSES.length >= 12, 'the table carries the documented classes');
  for (const required of ['contribution_recorded', 'checkpoint', 'paused', 'dead', 'refused', 'closed',
    'attention', 'guidance_delivered', 'recruited', 'integrated', 'capacity_pressure', 'resident_lifecycle']) {
    assert.ok(WAKE_CLASSES.includes(required), `the closed set carries ${required}`);
  }
  // One entry per class, one class per entry: no class is a second name for another.
  assert.equal(new Set(WAKE_CLASSES).size, WAKE_CLASSES.length);
  for (const row of WAKE_CLASS_TABLE) {
    assert.ok(row.rows.length > 0 || row.observation !== undefined, `${row.wakeClass} names its source rows`);
    assert.ok(typeof row.summary === 'string' && row.summary.length > 0, `${row.wakeClass} is documented`);
    assert.equal(row.next === null, row.terminal === false,
      `${row.wakeClass}: a terminal class names the command that acts on it, and only a terminal class does`);
  }
  // A ledger row reaches exactly one class, through the shape the coordination store really writes.
  assert.equal(wakeClassFor({ kind: 'swarm.participant_joined' }).wakeClass, 'recruited');
  assert.equal(wakeClassFor({ kind: 'evidence.mapped', payload: { kind: 'turn.paused' } }).wakeClass, 'paused');
  assert.equal(wakeClassFor({ kind: 'driver.recorded', payload: { kind: 'swarm.operation_refused' } }).wakeClass, 'refused');
  assert.equal(wakeClassFor({ kind: 'message.delivered', payload: {} }).wakeClass, 'guidance_delivered');
  assert.equal(wakeClassFor({ kind: 'web.audit', payload: { kind: 'readiness_probe' } }), null,
    'a row no class owns wakes nobody');
  // A consumer acts on a terminal wake with a command that exists.
  const closed = deriveWakeFrame({ seq: 4, ts: 'T', kind: 'swarm.closed', actor: 'root', payload: { swarmId: 'swarm-1' } });
  assert.equal(closed.next, 'baton swarm view swarm-1');
  assert.deepEqual(closed.subject, { kind: 'swarm', id: 'swarm-1' });
  assert.ok(wakeClassHelpLines().every((line) => typeof line === 'string' && line.length > 0));
});

test('the filter admits only the closed class set, and refuses an unknown class by naming the set', () => {
  const filter = parseWakeFilter({ kinds: 'closed,dead', swarms: 'swarm-1', participants: 'worker', since: '7' });
  assert.deepEqual([...filter.kinds], ['closed', 'dead']);
  assert.deepEqual([...filter.swarms], ['swarm-1']);
  assert.equal(filter.since, 7);
  assert.throws(() => parseWakeFilter({ kinds: 'closed,not_a_class' }), (error) => (
    error.code === 'invalid_wake_filter' && error.detail.unknown.includes('not_a_class')
    && error.detail.classes.includes('capacity_pressure') && error.detail.classes.includes('resident_lifecycle')
  ));
  assert.throws(() => parseWakeFilter({ since: '-1' }), (error) => error.code === 'invalid_wake_filter');
  // The rows the docs and the CLI help render are the filter's own vocabulary.
  const documented = wakeClassTableRows().map((row) => row.wakeClass);
  assert.deepEqual(documented, [...WAKE_CLASSES]);
});

// ── the deployment stream ───────────────────────────────────────────────────────────────────────

test('one attachment receives the rows of every swarm the resident hosts, including one created after it', { timeout: 120_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* closed by the test */ } });
  await owner.host();

  const first = await owner.swarms.create('The swarm that existed at attach');
  await first.recruit('worker', 'Stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });

  // ONE attachment, taken before the second swarm exists and never re-armed. The cursor is read
  // first so the test proves delivery rather than racing the attachment against the writes: an
  // attachment with no cursor means "from now", exactly like `swarm.watch`.
  const frames = [];
  const errors = [];
  const start = (await first.view()).cursor;
  const attachment = attach(repo, configured, { filter: { since: start }, errors, onFrame: (frame) => frames.push(frame) });
  t.after(() => attachment.close());

  await first.update('swarm.contribution_recorded', 'a finding from the first swarm');
  // The attachment must stay open: a stream that ended would leave the orchestrator silently deaf,
  // which is the failure this whole lane exists to remove.
  const outcome = await Promise.race([
    attachment.done,
    new Promise((resolve) => { const timer = setTimeout(() => resolve({ status: 'open' }), 2_000); timer.unref?.(); }),
  ]);
  assert.equal(outcome.status, 'open', `the wake attachment closed early: ${JSON.stringify(outcome)}`);
  await until(() => frames.some((frame) => frame.wakeClass === 'contribution_recorded' && frame.swarmId === first.id), frames,
    'the first swarm wakes the attachment', 30_000, errors);

  // A swarm created AFTER the attachment appears on the SAME stream.
  const second = await owner.swarms.create('The swarm created after the attachment');
  await second.recruit('worker', 'Stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });
  await second.update('swarm.contribution_recorded', 'a finding from the second swarm');
  await until(() => frames.some((frame) => frame.wakeClass === 'contribution_recorded' && frame.swarmId === second.id), frames,
    'a swarm created after the attachment wakes the same attachment');

  await second.close({ reason: 'proof complete' });
  await until(() => frames.some((frame) => frame.wakeClass === 'closed' && frame.swarmId === second.id), frames,
    'the second swarm closes on the same attachment');

  const recruitments = frames.filter((frame) => frame.wakeClass === 'recruited' && frame.swarmId === second.id);
  assert.ok(recruitments.some((frame) => frame.participantId === 'worker'),
    'a recruitment carries the participant it recruited');
  for (const frame of frames) {
    assert.equal(frame.kind, 'baton.wake');
    assert.equal(frame.schemaVersion, 1);
    assert.ok(WAKE_CLASSES.includes(frame.wakeClass), 'every frame carries a class from the closed set');
    assert.ok(Number.isSafeInteger(frame.seq) && frame.seq > 0, 'every frame carries its ledger seq');
    assert.ok(frame.row && Number.isSafeInteger(frame.row.seq), 'every frame carries the row that woke it');
    assert.equal(typeof frame.observation, 'boolean');
  }
  const contribution = frames.find((frame) => frame.wakeClass === 'contribution_recorded' && frame.swarmId === second.id);
  assert.equal(contribution.subject.kind, 'contribution');
  assert.ok(contribution.next.startsWith('baton swarm check'), 'the terminal class names the command that acts on it');
  // The stream serves both swarms: one attachment, no per-swarm process, no grep.
  assert.deepEqual([...new Set(frames.map((frame) => frame.swarmId))].filter(Boolean).sort(), [first.id, second.id].sort());
  attachment.close();
  const closed = await owner.close();
  assert.equal(closed.state, 'closed');
});

test('the cursor resumes from the last seq a consumer saw, with no gap and no duplicate', { timeout: 120_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* closed by the test */ } });
  await owner.host();
  const swarm = await owner.swarms.create('Cursor proof');
  await swarm.recruit('worker', 'Stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });

  const first = [];
  const start = (await swarm.view()).cursor;
  const attachment = attach(repo, configured, { filter: { since: start }, onFrame: (frame) => first.push(frame) });
  t.after(() => attachment.close());
  await swarm.update('swarm.contribution_recorded', 'first');
  await until(() => first.some((frame) => frame.wakeClass === 'contribution_recorded'), first, 'the first attachment sees rows');
  attachment.close();
  const cursor = first.at(-1).seq;

  await swarm.update('swarm.contribution_recorded', 'second');
  const resumed = [];
  const second = attach(repo, configured, { filter: { since: cursor }, onFrame: (frame) => resumed.push(frame) });
  t.after(() => second.close());
  await until(() => resumed.length >= 1, resumed, 'the resumed attachment sees the row it missed');

  const overlap = first.filter((frame) => resumed.some((candidate) => candidate.seq === frame.seq));
  assert.deepEqual(overlap, [], 'a resumed attachment re-delivers nothing the cursor already covered');
  assert.ok(resumed.every((frame) => frame.seq > cursor), 'every resumed frame is newer than the cursor');
  const resumedSeq = resumed.map((frame) => frame.seq);
  assert.deepEqual(resumedSeq, [...resumedSeq].sort((a, b) => a - b), 'the resumed feed is ordered');
  assert.equal(new Set(resumedSeq).size, resumedSeq.length, 'the resumed feed repeats no seq');
  // `Last-Event-ID` is the same cursor: a reconnect that carries only the SSE id resumes alike.
  const byHeader = [];
  const third = attach(repo, configured, { filter: {}, resume: cursor, onFrame: (frame) => byHeader.push(frame) });
  t.after(() => third.close());
  await swarm.update('swarm.contribution_recorded', 'third');
  await until(() => byHeader.length >= 1, byHeader, 'Last-Event-ID resumes the feed');
  assert.ok(byHeader.every((frame) => frame.seq > cursor));
  second.close(); third.close();
  await owner.close();
});

test('a deployment below its capacity floors wakes capacity_pressure at attach, and the CLI names the command that acts on it', { timeout: 120_000 }, async (t) => {
  const repo = repository(t);
  // The capacity observation is injected: this test asserts the WAKE, never real disk state.
  const configured = options(t, { capacity: { observe: () => ({ freeBytes: 0, freeInodes: 0 }) } });
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* closed by the test */ } });
  await owner.host();
  // The frame itself is the proof: a deployment whose capacity observation reads ready announces
  // no capacity_pressure at all, so `until` below would time out.

  const frames = [];
  const attachment = attach(repo, configured, { filter: { kinds: 'capacity_pressure' }, onFrame: (frame) => frames.push(frame) });
  t.after(() => attachment.close());
  await until(() => frames.length >= 1, frames, 'a standing capacity fault is announced at attach');
  const [wake] = frames;
  assert.equal(wake.wakeClass, 'capacity_pressure');
  assert.equal(wake.observation, true, 'a wake with no ledger row says so');
  assert.equal(wake.subject.id, 'worktree_capacity_exceeded');
  assert.equal(wake.next, 'baton doctor --check');
  attachment.close();
  await owner.close();
});
