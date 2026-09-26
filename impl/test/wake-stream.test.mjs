// Issue #294: the deployment-scope wake stream.
//
// ONE attachment to a resident receives the wake rows of EVERY swarm it hosts — including swarms
// created after the attachment — plus the deployment rows no swarm owns. These tests exercise the
// stream over a real resident (owner-only Unix socket, real principal, real coordination ledger)
// and the closed wake-class table that the filter, the CLI help and the docs all read.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import {
  WAKE_CLASS_TABLE, WAKE_CLASSES, WakeStream, deriveObservationFrame, deriveWakeFrame, openWakeStream,
  parseWakeFilter, wakeClassFor, wakeClassHelpLines, wakeClassRow, wakeClassTableRows,
} from '../src/wake-stream.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
// The deployment fixture is the repository's own: a mock adapter under an explicit route, so no
// provider credential is consulted and no real model is called.
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'bt-wakes-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'wakes@example.invalid', GIT_COMMITTER_EMAIL: 'wakes@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Wakes', GIT_COMMITTER_NAME: 'Wakes' });
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
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'bt-wakes-deployment-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'bt-wakes-config-'));
  const home = mkdtempSync(join(tmpdir(), 'bt-wakes-home-'));
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

// ── issue #272: wakes name facts, one wake per row, never bodies ──────────────────────────────

// #272 observation 1: a wake names {seq, kind, payloadKind} only — `swarm.context_updated` never
// said which key. The summary carries the actor and the subject from the row it names, and the
// bounded row identity instead of the row's body.
test('#272: a context wake names the key it wrote and its actor, never the body', () => {
  const frame = deriveWakeFrame({
    seq: 11, ts: '2026-09-14T07:16:32.897Z', kind: 'swarm.context_updated', actor: 'swarm-native:audit-a:surfaces',
    payload: { key: 'writing:surfaces', body: { file: 'surfaces.md', phase: 'requesting' }, swarmId: 'audit-a' },
  });
  assert.equal(frame.wakeClass, 'context_updated');
  assert.equal(frame.actor, 'swarm-native:audit-a:surfaces');
  assert.deepEqual(frame.subject, { kind: 'context', id: 'writing:surfaces' });
  assert.ok(!JSON.stringify(frame).includes('surfaces.md'),
    'the frame carries the row identity, never the row body');
});

// #272 proposal: one wake per semantic row. Harness chatter — native subagent observations in
// either container, content messages, tool/route telemetry, the operation request/completed pair,
// process readiness — wakes nobody, while each semantic row wakes exactly once.
test('#272: one wake per coordination row, and harness chatter wakes nobody', () => {
  const ledger = [
    { seq: 1, ts: 'T', kind: 'swarm.created', actor: 'root', payload: { swarmId: 's1' } },
    { seq: 2, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 9, digest: 'd', kind: 'native.subagent_observed', ts: 'T' } },
    { seq: 3, ts: 'T', kind: 'native.subagent_observed', actor: 'worker',
      payload: { worker: 'w-1', harness: 'omp', subagentId: 'child-1' } },
    { seq: 4, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 3, digest: 'd', kind: 'content.message', ts: 'T' } },
    { seq: 5, ts: 'T', kind: 'driver.recorded', actor: 'root',
      payload: { kind: 'swarm.operation_requested', swarmId: 's1', command: 'swarm.guide',
        request: { participantId: 'p1', body: 'the private guide text' } } },
    { seq: 6, ts: 'T', kind: 'driver.recorded', actor: 'root',
      payload: { kind: 'swarm.operation_completed', swarmId: 's1', command: 'swarm.guide' } },
    { seq: 7, ts: 'T', kind: 'swarm.context_updated', actor: 'swarm-native:s1:p1',
      payload: { key: 'writing:p1', body: { file: 'p1.md' }, swarmId: 's1' } },
    { seq: 8, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 4, digest: 'd', kind: 'turn.paused', ts: 'T' } },
    { seq: 9, ts: 'T', kind: 'swarm.contribution_recorded', actor: 'swarm-native:s1:p1',
      payload: { body: 'the contribution text', contributionId: 'c1', participantId: 'p1', swarmId: 's1' } },
    { seq: 10, ts: 'T', kind: 'driver.recorded', actor: 'policy',
      payload: { kind: 'route.observed', taskId: 't1', workerId: 'w-1' } },
    { seq: 11, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 5, digest: 'd', kind: 'lifecycle.process_ready', ts: 'T' } },
    { seq: 12, ts: 'T', kind: 'web.audit', actor: 'root', payload: { kind: 'readiness_probe' } },
    { seq: 13, ts: 'T', kind: 'driver.recorded', actor: 'root',
      payload: { kind: 'swarm.admission_queued', swarmId: 's1', participantId: 'p2', command: 'swarm.recruit' } },
  ];
  const coordination = {
    eventsView: (from) => ledger.filter((event) => event.seq >= (from ?? 1)),
    ledgerHeadSeq: () => ledger.at(-1).seq,
    swarms: () => [],
  };
  const stream = new WakeStream({ coordination, pollMs: 50, observationMs: 60_000 });
  const { frames, cursor } = stream.pull(parseWakeFilter({ since: 0 }));
  assert.deepEqual(frames.map((frame) => [frame.wakeClass, frame.seq]), [
    ['recruited', 1], ['context_updated', 7], ['paused', 8], ['contribution_recorded', 9], ['queued', 13],
  ]);
  for (const frame of frames) {
    assert.equal(typeof frame.actor, 'string', `${frame.wakeClass} names its actor`);
    assert.ok(frame.subject !== null, `${frame.wakeClass} names its subject`);
  }
  assert.ok(!frames.some((frame) => JSON.stringify(frame).includes('the private guide text')
    || JSON.stringify(frame).includes('the contribution text')),
    'no wake carries a request or contribution body');
  // Resuming from the cursor redelivers nothing: still one wake per row.
  const resumed = stream.pull(parseWakeFilter({ since: cursor }));
  assert.deepEqual(resumed.frames, []);
  assert.equal(resumed.cursor, cursor);
});

// #272 observation 4: terminal rows carry `next` — the command that acknowledges them — and only
// terminal rows do. The table stays the one vocabulary: the frame marks the row with its
// next/ack command rather than restating the table.
test('#272: terminal rows carry the command that acknowledges them, and only terminal rows do', () => {
  const attributed = new Map([['w-1', { swarmId: 's1', participantId: 'p1', runId: 'r1' }]]);
  const cases = [
    [{ seq: 1, ts: 'T', kind: 'swarm.participant_joined', actor: 'root',
      payload: { swarmId: 's1', participantId: 'p1', role: 'the recruit objective' } }, null],
    [{ seq: 2, ts: 'T', kind: 'swarm.participant_left', actor: 'root',
      payload: { swarmId: 's1', participantId: 'p1' } }, 'baton swarm view s1'],
    [{ seq: 3, ts: 'T', kind: 'swarm.assignment_updated', actor: 'root',
      payload: { assignmentId: 'a1', swarmId: 's1' } }, null],
    [{ seq: 4, ts: 'T', kind: 'swarm.work_updated', actor: 'root',
      payload: { workId: 'w1', swarmId: 's1' } }, null],
    [{ seq: 5, ts: 'T', kind: 'swarm.coupling_updated', actor: 'root',
      payload: { couplingId: 'c1', swarmId: 's1' } }, null],
    [{ seq: 6, ts: 'T', kind: 'swarm.context_updated', actor: 'root',
      payload: { key: 'k', body: {}, swarmId: 's1' } }, null],
    [{ seq: 7, ts: 'T', kind: 'swarm.contribution_recorded', actor: 'p1',
      payload: { contributionId: 'c1', participantId: 'p1', swarmId: 's1' } }, 'baton swarm check s1 p1 c1 CHECK_ID'],
    [{ seq: 8, ts: 'T', kind: 'swarm.contribution_reviewed', actor: 'lead',
      payload: { contributionId: 'c1', swarmId: 's1' } }, null],
    [{ seq: 9, ts: 'T', kind: 'knowledge.node_added', actor: 'p1',
      payload: { id: 'k1', runId: 'r1' } }, null],
    [{ seq: 10, ts: 'T', kind: 'swarm.closed', actor: 'root', payload: { swarmId: 's1' } }, 'baton swarm view s1'],
    [{ seq: 11, ts: 'T', kind: 'driver.recorded', actor: 'root',
      payload: { kind: 'swarm.operation_refused', swarmId: 's1', command: 'swarm.update' } },
      'baton swarm view s1'],
    [{ seq: 12, ts: 'T', kind: 'driver.recorded', actor: 'root',
      payload: { kind: 'swarm.admission_queued', swarmId: 's1', participantId: 'p1' } }, null],
    [{ seq: 13, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 4, digest: 'd', kind: 'lifecycle.crashed', ts: 'T' } },
      'baton swarm update s1 swarm.holder_released'],
    [{ seq: 14, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 5, digest: 'd', kind: 'turn.paused', ts: 'T' } },
      'baton swarm guide s1 p1'],
    [{ seq: 15, ts: 'T', kind: 'driver.recorded', actor: 'policy',
      payload: { kind: 'question.asked', requestId: 'q1', runId: 'r1', worker: 'w-1' } },
      'baton run answer r1 q1 --text TEXT'],
    [{ seq: 16, ts: 'T', kind: 'message.delivered', actor: 'rt',
      payload: { messageId: 'm1', worker: 'w-1' } }, null],
    [{ seq: 17, ts: 'T', kind: 'driver.recorded', actor: 'policy',
      payload: { kind: 'integration.completed', taskId: 't1' } }, 'baton run view {runId}'],
    [{ seq: 18, ts: 'T', kind: 'evidence.mapped', actor: 'policy',
      payload: { worker: 'w-1', workerSeq: 6, digest: 'd', kind: 'worktree.progress_checkpointed', ts: 'T' } },
      null],
  ];
  for (const [event, next] of cases) {
    const frame = deriveWakeFrame(event, attributed);
    assert.ok(frame !== null, `${event.kind} wakes`);
    assert.equal(frame.next, next, `${event.kind} marks its row with ${JSON.stringify(next)}`);
    assert.ok(!JSON.stringify(frame).includes('the recruit objective'),
      'a wake never carries the request body beside the row');
  }
  for (const [wakeClass, observation] of [
    ['capacity_pressure', { payload: { code: 'worktree_capacity_exceeded' }, actor: 'deployment' }],
    ['resident_lifecycle', { payload: { incarnation: 'incarnation-1' }, actor: 'deployment' }],
  ]) {
    const frame = deriveObservationFrame(wakeClassRow(wakeClass), observation, 99, 'T');
    assert.equal(typeof frame.next, 'string', `${wakeClass} marks its row with next`);
    assert.ok(frame.next.startsWith('baton doctor'), `${wakeClass} names the command that acts on it`);
  }
});

// ── #547: the observation arm rides the ledger's own append cursor ────────────────────────────

/** The unit shape the observation rows drive: a mutable ledger, an injected observation, and a
 * clock the test owns — so "why did the stream re-read" is a fact the row can name (an append, or
 * the ceiling), never a wall-clock accident. */
function observationFixture({ observation, observationMs = 60_000, now = () => 1_000 }) {
  const ledger = [{ seq: 1, ts: 'T', kind: 'swarm.created', actor: 'root', payload: { swarmId: 's1' } }];
  const coordination = {
    eventsView: (from) => ledger.filter((event) => event.seq >= (from ?? 1)),
    ledgerHeadSeq: () => ledger.at(-1).seq,
    swarms: () => [],
  };
  return {
    stream: new WakeStream({ coordination, observation, observationMs, now, pollMs: 50 }),
    append: () => ledger.push({ seq: ledger.at(-1).seq + 1, ts: 'T', kind: 'swarm.context_updated',
      actor: 'root', payload: { key: `k${ledger.length}`, swarmId: 's1' } }),
  };
}

test('#547: a standing observation whose measurements drift is ONE condition, not a crossing per read', { timeout: 30_000 }, () => {
  let reads = 0;
  const f = observationFixture({
    observation: () => ({ capacity: {
      state: 'blocked', code: 'worktree_capacity_exceeded', freeBytes: 100 - reads++,
    } }),
  });
  const observations = () => f.stream.pull(parseWakeFilter({}), { includeObservations: true })
    .frames.filter((frame) => frame.observation === true);
  const announced = [...observations()];
  for (let index = 0; index < 5; index += 1) {
    f.append();
    announced.push(...observations());
  }
  assert.equal(reads, 6, 'every append re-reads the observation');
  assert.equal(announced.length, 1,
    'a standing fault whose free bytes drift is announced once at attach — the drift is not a crossing');
  assert.equal(announced[0].wakeClass, 'capacity_pressure');
  assert.equal(announced[0].subject.id, 'worktree_capacity_exceeded');
});

test('#547: a crossing is announced on the append that precedes it, never on the next poll window', { timeout: 30_000 }, () => {
  let code = 'worktree_capacity_exceeded';
  const f = observationFixture({ observation: () => ({ capacity: { state: 'blocked', code, freeBytes: 0 } }) });
  const observations = () => f.stream.pull(parseWakeFilter({}), { includeObservations: true })
    .frames.filter((frame) => frame.observation === true);
  assert.equal(observations().length, 1, 'the standing fault is announced at attach');
  // The condition CHANGES and the deployment writes: the crossing rides that append. The clock in
  // this fixture never advances, so a stream that re-read on its own timer could not see it.
  code = 'worktree_capacity_unavailable';
  f.append();
  const crossed = observations();
  assert.equal(crossed.length, 1, 'the changed condition is announced with the append that carried it');
  assert.equal(crossed[0].subject.id, 'worktree_capacity_unavailable');
  f.append();
  assert.deepEqual(observations(), [], 'and an unchanged condition re-announces nothing');
});
