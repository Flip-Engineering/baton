// Issue #33 — typed task-horizon scratchpad writes and settle-time elevation.
// Red suite for docs/reference/evidence/scratchpad-2026-07-23/scratchpad-decisions.md (v2,
// including the R33R fold block: R33R-2 mutator/completeness registration, R33R-3 any-terminal
// elevation trigger + treeBinding honesty, R33R-4 REFLEX-1 up-channel transport, R33R-5
// viewer-parameterized workflowHorizon, R33R-6 the four extra pinned rows).
//
// Part F fixed-clock rule: every fixture injects a fixed store clock and a fixed coordinator
// `now`. No test reads Date.now(), arms a live timer, or derives an id from wall time — a
// hardcoded expiry beside a real clock is the issue #42 time-bomb shape this suite must not
// reproduce.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import {
  MAX_SCRATCHPAD_BATCH_BYTES,
  MAX_SCRATCHPAD_ENTRY_BYTES,
  MAX_SCRATCHPAD_SHARED_ENTRIES,
  MAX_SCRATCHPAD_SNAPSHOT_REAPS,
  MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS,
  MAX_SCRATCHPAD_WORKER_ENTRIES,
  MAX_SCRATCHPAD_WRITE_REQUEST_BYTES,
} from '../src/coordination-store.mjs';
import {
  MAX_SCRATCHPAD_VIEW_BYTES,
  MAX_SCRATCHPAD_VIEW_ITEMS,
  purgeScratchpadViewCache,
  projectScratchpadView,
} from '../src/application.mjs';
import { createScratchpadEntry } from '../src/messages.mjs';

// ---------------------------------------------------------------------------
// Fixed clocks + shared coordinates
// ---------------------------------------------------------------------------

const STORE_CLOCK_ISO = '2026-07-23T00:00:00.000Z';
const storeClock = () => STORE_CLOCK_ISO;

const repoId = 'repo-scratchpad-33';
const runId = 'run-sp33';
const taskA = 'task-sp33-a';
const taskB = 'task-sp33-b';
const workerA = 'w-alpha';
const workerB = 'w-beta';
const treeSha = '3'.repeat(40);

const dirs = [];
function tmpRoot(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-sp33-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// Independent canonical digest recomputation — deliberately a second implementation so SP3
// proves hub identity rather than echoing the store's own helper.
const canonical = (value) => (Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const canonicalDigest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const canonicalBytes = (value) => Buffer.byteLength(JSON.stringify(canonical(value)));

const stores = [];
function freshStore(label, options = {}) {
  const store = new CoordinationStore(join(tmpRoot(label), 'coordination'), {
    repoId, deploymentBaseSha: treeSha, clock: storeClock, ...options,
  });
  stores.push(store);
  return store;
}
test.after(() => {
  for (const store of stores) {
    try { store.releaseWriterLease({ requireOwned: true }); } catch { /* already released */ }
  }
});

const workerAuth = (worker, key) => ({ actor: 'worker', principalId: worker, key });
const orchestratorAuth = (key) => ({ actor: 'orchestrator', key });
const policyAuth = (key) => ({ actor: 'policy', key });

const noteEntry = (text = 'the migration needs a backfill step') => ({ kind: 'note', text });
const planEntry = (objective = 'land the backfill', steps = [{ text: 'write it', state: 'todo' }]) => ({
  kind: 'plan', objective, steps, supersedes: null,
});
const doubtEntry = (question = 'is the index hot?') => ({ kind: 'doubt', question, context: null });
const linkEntry = (target, relation = 'reference', label = 'upstream note') => ({
  kind: 'link', label, relation, target,
});

/** Admit one worker entry through the store's own authority path. */
function write(store, { worker = workerA, task = taskA, entry = noteEntry(), key, run = runId } = {}) {
  return store.writeScratchpad(
    { runId: run, taskId: task, workerId: worker, entry },
    workerAuth(worker, key ?? `scratchpad.entry_written:${worker}:${entry.kind}:${store.snapshot().lastSeq + 1}`),
  );
}

/** Register the durable steering binding rule 19/20 requires of an elevating orchestrator. */
function registerSteering(store, { run = runId } = {}) {
  return store.recordDriver('steering.registered', { runId: run },
    orchestratorAuth(`driver.recorded:steering.registered:${run}`));
}

// ===========================================================================
// SP1 — no subsystem / worker authority
// ===========================================================================

test('SP1: the sole worker write authority lands in the existing coordination ledger', () => {
  const store = freshStore('sp1-write');
  const before = store.snapshot().lastSeq;
  const receipt = write(store, { entry: noteEntry(), key: 'sp1:w1' });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.result, 'written');
  assert.match(receipt.entry.entryId, /^scratchpad-entry:[0-9a-f]{64}$/u);
  assert.equal(receipt.entry.scope, `worker:${workerA}`);
  assert.equal(receipt.event.kind, 'scratchpad.entry_written');
  assert.equal(receipt.event.seq, before + 1, 'the write is one event on the existing ledger');
  assert.equal(receipt.event.ts, STORE_CLOCK_ISO, 'createdAt comes from the injected fixed clock');
  assert.ok(!Object.hasOwn(receipt.event, 'batch'), 'a standalone worker write carries no batch metadata');
});

test('SP1: a worker cannot author identity, scope, ordinal, digest, candidacy, or provenance', () => {
  const store = freshStore('sp1-identity');
  for (const forbidden of [
    { scope: 'shared' }, { scope: `worker:${workerB}` },
    { entryId: `scratchpad-entry:${'a'.repeat(64)}` }, { entryDigest: 'b'.repeat(64) },
    { contentDigest: 'c'.repeat(64) }, { ordinal: 7 }, { createdAt: STORE_CLOCK_ISO },
    { candidateState: 'candidate' }, { source: null }, { scratchFactId: 'scratch-fact:x' },
  ]) {
    assert.throws(
      () => store.writeScratchpad(
        { runId, taskId: taskA, workerId: workerA, entry: noteEntry(), ...forbidden },
        workerAuth(workerA, `sp1:identity:${Object.keys(forbidden)[0]}`),
      ),
      (error) => error?.name === 'CoordinationRefusal' && error.code === 'scratchpad_write_invalid',
      `caller-supplied ${Object.keys(forbidden)[0]} must be refused`,
    );
  }
});

test('SP1: a worker writes only its own scope and never the shared partition', () => {
  const store = freshStore('sp1-scope');
  const receipt = write(store, { key: 'sp1:scope' });
  assert.equal(receipt.entry.scope, `worker:${workerA}`);
  assert.notEqual(receipt.entry.scope, 'shared');
  // The shared partition is populated only by the task-settle elevation authority (rule 2).
  assert.equal(store.scratchpadFence(runId, 'shared'), 0);
});

test('SP1: the exported surface has no readScratchpad, worker settlement API, or generic append', async () => {
  const store = freshStore('sp1-surface');
  for (const absent of [
    'readScratchpad', 'appendScratchpad', 'editScratchpad', 'deleteScratchpad',
    'promoteScratchpad', 'workerElevateScratchpad',
  ]) {
    assert.equal(typeof store[absent], 'undefined', `${absent}() must not exist`);
  }
  for (const present of [
    'writeScratchpad', 'elevateTaskScratchpad', 'settleWorkflowScratchpad', 'reapRunScratchpads',
    'scratchpadSnapshotBatch', 'scratchpadSnapshot',
  ]) {
    assert.equal(typeof store[present], 'function', `${present}() is part of the closed surface`);
  }
});

// ===========================================================================
// SP2 — closed grammar and bounds
// ===========================================================================

test('SP2: one boundary-value fixture per accepted shape is admitted', () => {
  const store = freshStore('sp2-accept');
  const accepted = [
    noteEntry('x'.repeat(2048)),
    { kind: 'plan', objective: 'y'.repeat(512), steps: [{ text: 'z'.repeat(512), state: 'doing' }], supersedes: null },
    { kind: 'doubt', question: 'q'.repeat(1024), context: 'c'.repeat(2048) },
    linkEntry({ type: 'url', url: 'https://example.invalid/a' }, 'supports'),
    linkEntry({ type: 'repo_path', path: 'impl/src/coordination-store.mjs' }, 'depends_on'),
  ];
  for (const [index, entry] of accepted.entries()) {
    const receipt = write(store, { entry, key: `sp2:accept:${index}` });
    assert.equal(receipt.ok, true, `${entry.kind} boundary fixture is admitted`);
  }
});

test('SP2: unknown, missing, and discriminator-inapplicable fields fail scratchpad_entry_invalid', () => {
  const store = freshStore('sp2-closed');
  const rejected = [
    { kind: 'note', text: 'ok', extra: 1 },
    { kind: 'note' },
    { kind: 'note', text: 'ok', objective: 'not for a note' },
    { kind: 'unknown', text: 'ok' },
    { kind: 'plan', objective: 'o', steps: [], supersedes: null },
    { kind: 'plan', objective: 'o', steps: Array.from({ length: 17 }, () => ({ text: 't', state: 'todo' })), supersedes: null },
    { kind: 'plan', objective: 'o', steps: [{ text: 't', state: 'nope' }], supersedes: null },
    { kind: 'plan', objective: 'o', steps: [{ text: 't' }], supersedes: null },
    { kind: 'doubt', question: 'q' },
    linkEntry({ type: 'url', url: 'https://example.invalid/a' }, 'endorses'),
    linkEntry({ type: 'url', url: 'http://example.invalid/a' }),
    linkEntry({ type: 'url', url: 'https://user:pw@example.invalid/a' }),
    linkEntry({ type: 'repo_path', path: '/absolute' }),
    linkEntry({ type: 'repo_path', path: '../escape' }),
    linkEntry({ type: 'repo_path', path: 'back\\slash' }),
    linkEntry({ type: 'repo_path', path: 'C:/drive' }),
    linkEntry({ type: 'repo_path', path: 'double//segment' }),
    linkEntry({ type: 'repo_path', path: 'trailing/' }),
    linkEntry({ type: 'entry', entryId: 'no-prefix', entryDigest: 'a'.repeat(64) }),
    linkEntry({ type: 'entry', entryId: `scratchpad-entry:${'A'.repeat(64)}`, entryDigest: 'a'.repeat(64) }),
    linkEntry({ type: 'entry', entryId: `scratchpad-entry:${'a'.repeat(64)}`, entryDigest: 'a'.repeat(63) }),
    { kind: 'note', text: 'null\u0000byte' },
    { kind: 'note', text: '' },
    { kind: 'note', text: 'x'.repeat(2049) },
  ];
  for (const [index, entry] of rejected.entries()) {
    assert.throws(
      () => write(store, { entry, key: `sp2:reject:${index}` }),
      (error) => error?.name === 'CoordinationRefusal' && error.code === 'scratchpad_entry_invalid',
      `fixture ${index} (${JSON.stringify(entry).slice(0, 70)}) must fail scratchpad_entry_invalid`,
    );
  }
});

test('SP2: arrays must be real arrays and steps may not be sparse', () => {
  const store = freshStore('sp2-arrays');
  const sparse = [{ text: 't', state: 'todo' }];
  sparse[2] = { text: 'u', state: 'done' }; // leaves a hole at index 1
  for (const [index, steps] of [sparse, { 0: { text: 't', state: 'todo' }, length: 1 }].entries()) {
    assert.throws(
      () => write(store, { entry: { kind: 'plan', objective: 'o', steps, supersedes: null }, key: `sp2:arr:${index}` }),
      (error) => error?.code === 'scratchpad_entry_invalid',
    );
  }
});

test('SP2: total canonical content over MAX_SCRATCHPAD_ENTRY_BYTES is refused before append', () => {
  const store = freshStore('sp2-entry-bytes');
  assert.equal(MAX_SCRATCHPAD_ENTRY_BYTES, 8_192);
  const steps = Array.from({ length: 16 }, () => ({ text: 'y'.repeat(512), state: 'todo' }));
  const oversize = { kind: 'plan', objective: 'o'.repeat(512), steps, supersedes: null };
  assert.ok(canonicalBytes(oversize) > MAX_SCRATCHPAD_ENTRY_BYTES, 'the fixture really is over the ceiling');
  const before = store.snapshot().lastSeq;
  // Issue #89 Decision 2/3: the canonical entry ceiling gained the Decision-3 coaching shape —
  // the refusal code is now the registry lane's scratchpad_entry_exceeded (B14 of the
  // frame-economics suite), with {cap, actual, unit, gracefulPath} on the thrown error.
  assert.throws(() => write(store, { entry: oversize, key: 'sp2:entry-bytes' }),
    (error) => error?.code === 'scratchpad_entry_exceeded');
  assert.equal(store.snapshot().lastSeq, before, 'no event was appended');
});

test('SP2: a raw request over MAX_SCRATCHPAD_WRITE_REQUEST_BYTES refuses before NFKC/URL parsing', () => {
  const store = freshStore('sp2-raw-bytes');
  assert.equal(MAX_SCRATCHPAD_WRITE_REQUEST_BYTES, 16_384);
  const huge = { kind: 'note', text: 'x'.repeat(20_000) };
  assert.throws(() => write(store, { entry: huge, key: 'sp2:raw' }),
    (error) => error?.code === 'scratchpad_entry_invalid');
});

test('SP2: the raw walker refuses accessors, symbol keys, cycles, and non-JSON values without invoking user code', () => {
  const store = freshStore('sp2-walker');
  let getterInvoked = false;
  const accessor = { kind: 'note' };
  Object.defineProperty(accessor, 'text', {
    enumerable: true,
    get() { getterInvoked = true; return 'x'; },
  });

  const cyclic = { kind: 'note', text: 'x' };
  cyclic.self = cyclic;

  const fixtures = [
    accessor,
    cyclic,
    { kind: 'note', text: 'x', [Symbol('s')]: 1 },
    { kind: 'note', text: Number.POSITIVE_INFINITY },
    { kind: 'note', text: undefined },
    { kind: 'note', text: () => 'x' },
    { kind: 'note', text: 10n },
    Object.assign(Object.create({ inherited: 'x' }), { kind: 'note' }),
  ];
  for (const [index, entry] of fixtures.entries()) {
    assert.throws(() => write(store, { entry, key: `sp2:walker:${index}` }),
      (error) => error?.code === 'scratchpad_entry_invalid', `walker fixture ${index}`);
  }
  assert.equal(getterInvoked, false, 'the bounded walker must never invoke an attacker getter');
});

test('SP2: a fresh entry past the worker partition ceiling fails scratchpad_partition_exhausted', () => {
  const store = freshStore('sp2-ceiling');
  assert.equal(MAX_SCRATCHPAD_WORKER_ENTRIES, 128);
  assert.equal(MAX_SCRATCHPAD_SHARED_ENTRIES, 512);
  for (let index = 0; index < MAX_SCRATCHPAD_WORKER_ENTRIES; index += 1) {
    write(store, { entry: noteEntry(`entry ${index}`), key: `sp2:fill:${index}` });
  }
  assert.throws(() => write(store, { entry: noteEntry('one too many'), key: 'sp2:overflow' }),
    (error) => error?.code === 'scratchpad_partition_exhausted');
});

test('SP2: the reserved scratchpad namespace and scratchpad: prefix are closed to ordinary legacy Scratch', () => {
  const store = freshStore('sp2-reserved');
  const envRef = { repoId, treeSha };
  assert.throws(() => store.postScratchFact({
    grounding: 'observed', namespace: 'scratchpad', key: 'scratchpad:x', resource: 'scratchpad:x', envRef,
  }, orchestratorAuth('sp2:reserved:fact')),
  (error) => error?.code === 'reserved_scratch_namespace');
  assert.throws(() => store.claimScratch({ resource: 'scratchpad:x', envRef },
    orchestratorAuth('sp2:reserved:claim')),
  (error) => error?.code === 'reserved_scratch_namespace');
  assert.throws(() => store.readScratch('scratchpad:x', envRef, { readerActor: 'worker' },
    orchestratorAuth('sp2:reserved:read')),
  (error) => error?.code === 'reserved_scratch_namespace');
});

test('SP2: URL and repository-path admission normalizes without touching network or filesystem', () => {
  const store = freshStore('sp2-normalize');
  const url = write(store, {
    entry: linkEntry({ type: 'url', url: 'https://Example.INVALID/a/../b?q=1' }),
    key: 'sp2:url',
  });
  assert.equal(url.entry.content.target.url, 'https://example.invalid/b?q=1',
    'the stored string is the canonical URL.href');
  const path = write(store, {
    entry: linkEntry({ type: 'repo_path', path: 'impl/src/wave.mjs' }),
    key: 'sp2:path',
  });
  assert.equal(path.entry.content.target.path, 'impl/src/wave.mjs');
});

// ===========================================================================
// SP3 — hub identity, content addressing, idempotency
// ===========================================================================

test('SP3: entryId, contentDigest, and entryDigest equal independent recomputation over rule 9', () => {
  const store = freshStore('sp3-identity');
  const entry = noteEntry('hub identity is not worker input');
  const mintSeq = store.snapshot().lastSeq + 1;
  const receipt = write(store, { entry, key: 'sp3:identity' });
  const row = receipt.entry;

  const expectedEntryId = `scratchpad-entry:${canonicalDigest({
    runId, taskId: taskA, workerId: workerA, scope: `worker:${workerA}`, ordinal: 1, mintSeq,
  })}`;
  assert.equal(row.entryId, expectedEntryId);
  assert.equal(row.ordinal, 1);

  const expectedContentDigest = canonicalDigest(row.content);
  assert.equal(row.contentDigest, expectedContentDigest);

  assert.equal(row.entryDigest, canonicalDigest({
    schemaVersion: 1, entryId: row.entryId, runId, taskId: taskA, workerId: workerA,
    scope: `worker:${workerA}`, ordinal: 1, kind: 'note',
    contentDigest: expectedContentDigest, content: row.content,
  }));
});

test('SP3: NFKC/trim-equivalent inputs resolve to one admitted content digest and one idempotent event', () => {
  const store = freshStore('sp3-normalize');
  const first = write(store, { entry: noteEntry('ﬁle note'), key: 'sp3:norm' });
  const replay = write(store, { entry: noteEntry('  file note  '), key: 'sp3:norm' });
  assert.equal(first.entry.content.text, 'file note', 'NFKC folds the ligature and trim strips edges');
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.event.seq, first.event.seq, 'the same key with equivalent content returns the prior event');
});

test('SP3: one changed normalized byte or ownership coordinate under the same key is a write conflict', () => {
  const store = freshStore('sp3-conflict');
  write(store, { entry: noteEntry('original'), key: 'sp3:conflict' });
  assert.throws(() => write(store, { entry: noteEntry('changed'), key: 'sp3:conflict' }),
    (error) => error?.code === 'scratchpad_write_conflict');
  assert.throws(() => write(store, { entry: noteEntry('original'), worker: workerB, task: taskB, key: 'sp3:conflict' }),
    (error) => error?.code === 'scratchpad_write_conflict');
});

test('SP3: a plan supersedes an exact same-scope plan and cannot cite anything else', () => {
  const store = freshStore('sp3-supersedes');
  const base = write(store, { entry: planEntry('v1'), key: 'sp3:plan:1' });
  const note = write(store, { entry: noteEntry('a note, not a plan'), key: 'sp3:plan:note' });
  const sibling = write(store, {
    entry: planEntry('sibling'), worker: workerB, task: taskB, key: 'sp3:plan:sibling',
  });

  const ok = write(store, {
    entry: {
      kind: 'plan', objective: 'v2', steps: [{ text: 'revise', state: 'doing' }],
      supersedes: { entryId: base.entry.entryId, entryDigest: base.entry.entryDigest },
    },
    key: 'sp3:plan:2',
  });
  assert.equal(ok.ok, true);

  for (const [label, supersedes] of [
    ['wrong digest', { entryId: base.entry.entryId, entryDigest: 'f'.repeat(64) }],
    ['a note', { entryId: note.entry.entryId, entryDigest: note.entry.entryDigest }],
    ['another scope', { entryId: sibling.entry.entryId, entryDigest: sibling.entry.entryDigest }],
    ['unknown entry', { entryId: `scratchpad-entry:${'0'.repeat(64)}`, entryDigest: '0'.repeat(64) }],
  ]) {
    assert.throws(() => write(store, {
      entry: { kind: 'plan', objective: 'bad', steps: [{ text: 't', state: 'todo' }], supersedes },
      key: `sp3:plan:bad:${label}`,
    }), (error) => error?.code === 'scratchpad_entry_invalid', `supersedes ${label} must be refused`);
  }
});

/** Drive one worker partition to a settled shared successor set. Returns the write receipts and
 * the elevation receipt so later blocks can assert on both partitions. */
function settleTaskWith(store, entries, { selected = null, worker = workerA, task = taskA } = {}) {
  registerSteering(store);
  const written = entries.map((entry, index) => write(store, {
    entry, worker, task, key: `settle:${task}:${worker}:${index}`,
  }));
  const entryIds = selected ?? written.map((receipt) => receipt.entry.entryId);
  const elevation = store.elevateTaskScratchpad({
    runId, taskId: task, workerId: worker,
    expectedScratchpadFence: store.scratchpadFence(runId, `worker:${worker}`),
    entryIds,
  }, orchestratorAuth(`elevate:${task}:${worker}`));
  return { written, elevation };
}

// ===========================================================================
// SP4 — complete fold surface
// ===========================================================================

test('SP4: exactly three scratchpad kinds are folded and there is no scratchpad.read', () => {
  const applySource = CoordinationStore.prototype._apply.toString();
  const folded = new Set();
  for (const match of applySource.matchAll(/event\.kind === '([^']+)'/gu)) folded.add(match[1]);
  for (const match of applySource.matchAll(/\[([^\]]*)\]\.includes\(event\.kind\)/gu)) {
    for (const literal of match[1].matchAll(/'([^']+)'/gu)) folded.add(literal[1]);
  }
  const scratchpadKinds = [...folded].filter((kind) => kind.startsWith('scratchpad.')).sort();
  assert.deepEqual(scratchpadKinds, [
    'scratchpad.entry_elevated', 'scratchpad.entry_written', 'scratchpad.partition_reaped',
  ]);
  assert.equal(folded.has('scratchpad.read'), false, 'a scratchpad poll is never evented');
});

test('SP4: an undeclared scratchpad kind is refused by the fold tripwire', () => {
  const store = freshStore('sp4-tripwire');
  assert.throws(() => store._apply({
    schemaVersion: 1, seq: 999, ts: STORE_CLOCK_ISO, kind: 'scratchpad.undeclared',
    actor: 'worker', idempotencyKey: 'sp4:tripwire', payload: {},
  }), (error) => error?.code === 'unsupported_event_kind');
});

test('SP4: every scratchpad projection map is a declared checkpoint field', () => {
  const store = freshStore('sp4-checkpoint');
  write(store, { key: 'sp4:cp' });
  const checkpointFields = new Set(Object.keys(store._projectionCheckpointPayload()));
  for (const field of [
    '_scratchpadEntries', '_scratchpadEntriesByScope', '_scratchpadFences',
    '_scratchpadElevations', '_scratchpadReaps',
  ]) {
    assert.ok(checkpointFields.has(field), `${field} must be a projection checkpoint field`);
  }
});

test('SP4: live state and a full-log replay reconstruct byte-identical scratchpad projections', () => {
  const root = tmpRoot('sp4-replay');
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha, clock: storeClock,
  });
  settleTaskWith(store, [noteEntry('replayed'), planEntry('replayed plan')]);
  const live = store.snapshot().scratchpad;
  store.releaseWriterLease({ requireOwned: true });

  const replayed = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha, clock: storeClock,
  });
  stores.push(replayed);
  assert.deepEqual(replayed.snapshot().scratchpad, live,
    'full replay reconstructs entries, elevations, reaps, and fences byte-identically');
});

test('SP4: snapshot().scratchpad exists and is empty on a fresh store, then complete and clone-safe', () => {
  const store = freshStore('sp4-snapshot');
  const empty = store.snapshot().scratchpad;
  assert.deepEqual(empty, {
    entries: [], elevations: [], reaps: [], fences: [], scratchpadReapsTruncated: false,
  });

  const { elevation } = settleTaskWith(store, [noteEntry('kept')]);
  const filled = store.snapshot().scratchpad;
  assert.equal(filled.entries.length, 1, 'the shared successor survives the worker reap');
  assert.equal(filled.entries[0].scope, 'shared');
  assert.equal(filled.reaps.length, 1);
  assert.equal(filled.reaps[0].basis, 'task_settled');
  assert.equal(elevation.result, 'settled');

  filled.entries.push({ tampered: true });
  assert.equal(store.snapshot().scratchpad.entries.length, 1, 'snapshot output is clone-safe');
});

test('SP4: the batch allowlist carries exactly the four scratchpad transaction kinds', () => {
  const appendBatchSource = CoordinationStore.prototype._appendBatch.toString();
  for (const kind of [
    'scratchpad_task_settlement', 'scratchpad_link_citation',
    'scratchpad_workflow_settlement', 'scratchpad_stop_cleanup',
  ]) {
    assert.ok(appendBatchSource.includes(kind), `${kind} must be an allowlisted batch kind`);
  }
});

test('SP4: a note elevation is one atomic entry_elevated + scratch.fact_posted batch', () => {
  const store = freshStore('sp4-atomic');
  const { elevation } = settleTaskWith(store, [noteEntry('bridged')]);
  const events = store.snapshot().lastSeq;
  const ledger = store._events.slice(-3);

  assert.deepEqual(ledger.map((event) => event.kind), [
    'scratchpad.entry_elevated', 'scratch.fact_posted', 'scratchpad.partition_reaped',
  ]);
  const batchId = ledger[0].batch.id;
  for (const [index, event] of ledger.entries()) {
    assert.equal(event.batch.kind, 'scratchpad_task_settlement');
    assert.equal(event.batch.id, batchId, 'every member shares one batch id');
    assert.equal(event.batch.index, index, 'index is contiguous from zero');
    assert.equal(event.batch.count, 3, 'count is equal on all members');
  }
  assert.equal(elevation.reapEventSeq, events);
  assert.equal(elevation.elevated.length, 1);
  assert.match(elevation.elevated[0].scratchFactId, /^scratch-fact:[0-9a-f]{64}$/u);
});

test('SP4: plan, doubt, and link elevations mint no bridge fact', () => {
  const store = freshStore('sp4-nofact');
  const { elevation } = settleTaskWith(store, [
    planEntry('operational state'), doubtEntry(), linkEntry({ type: 'url', url: 'https://example.invalid/x' }),
  ]);
  assert.equal(elevation.elevated.length, 3);
  for (const row of elevation.elevated) assert.equal(row.scratchFactId, null);
  assert.equal(store._events.filter((event) => event.kind === 'scratch.fact_posted').length, 0);
});

test('SP4: an injected append failure leaves neither shared successors nor a reap', () => {
  const store = freshStore('sp4-atomicity');
  registerSteering(store);
  const written = write(store, { entry: noteEntry('must survive'), key: 'sp4:atomic:1' });
  const beforeSeq = store.snapshot().lastSeq;
  const beforeWorkerFence = store.scratchpadFence(runId, `worker:${workerA}`);
  const beforeSharedFence = store.scratchpadFence(runId, 'shared');

  const realAppendFile = store._appendFile;
  store._appendFile = () => { throw Object.assign(new Error('injected append failure'), { code: 'injected_io' }); };
  assert.throws(() => store.elevateTaskScratchpad({
    runId, taskId: taskA, workerId: workerA,
    expectedScratchpadFence: beforeWorkerFence,
    entryIds: [written.entry.entryId],
  }, orchestratorAuth('sp4:atomic:elevate')));
  store._appendFile = realAppendFile;

  assert.equal(store.snapshot().lastSeq, beforeSeq, 'no member of the group landed');
  assert.equal(store.scratchpadFence(runId, `worker:${workerA}`), beforeWorkerFence);
  assert.equal(store.scratchpadFence(runId, 'shared'), beforeSharedFence);
});

test('SP4: reaped raw content is absent from live maps, checkpoint state, and snapshot output', () => {
  const store = freshStore('sp4-reap-content');
  const secretish = 'the private worker sentence that must not survive its reap';
  registerSteering(store);
  const written = write(store, { entry: noteEntry(secretish), key: 'sp4:reap:1' });
  store.elevateTaskScratchpad({
    runId, taskId: taskA, workerId: workerA,
    expectedScratchpadFence: store.scratchpadFence(runId, `worker:${workerA}`),
    entryIds: [], // elevate nothing: the entry is reaped, not promoted
  }, orchestratorAuth('sp4:reap:elevate'));

  const serializedCheckpoint = JSON.stringify(store._projectionCheckpointPayload());
  assert.equal(serializedCheckpoint.includes(secretish), false, 'checkpoint state drops reaped content');
  assert.equal(JSON.stringify(store.snapshot().scratchpad).includes(secretish), false,
    'snapshot output drops reaped content');
  const receipt = store.snapshot().scratchpad.reaps[0];
  assert.deepEqual(Object.keys(receipt).sort(), [
    'basis', 'dispositionDigest', 'dispositions', 'eventSeq', 'observedFence', 'runId', 'scope', 'taskId',
  ]);
  assert.equal(receipt.dispositions[0].result, 'not_elevated');
  assert.equal(receipt.dispositions[0].reasonCode, 'orchestrator_skipped');
  assert.equal(receipt.dispositions[0].targetId, null);
  assert.equal(receipt.dispositions[0].entryId, written.entry.entryId);
  // The immutable ledger event remains the historical replay source (Part G).
  assert.ok(store._events.some((event) => JSON.stringify(event.payload).includes(secretish)));
});

test('SP4: an exact reap retry returns its original receipt and a changed selection conflicts', () => {
  const store = freshStore('sp4-retry');
  registerSteering(store);
  const first = write(store, { entry: noteEntry('a'), key: 'sp4:retry:a' });
  const second = write(store, { entry: noteEntry('b'), key: 'sp4:retry:b' });
  const fence = store.scratchpadFence(runId, `worker:${workerA}`);
  const request = {
    runId, taskId: taskA, workerId: workerA, expectedScratchpadFence: fence,
    entryIds: [first.entry.entryId],
  };
  const settled = store.elevateTaskScratchpad(request, orchestratorAuth('sp4:retry:elevate'));
  assert.equal(settled.result, 'settled');

  const retried = store.elevateTaskScratchpad(request, orchestratorAuth('sp4:retry:elevate'));
  assert.equal(retried.result, 'idempotent');
  assert.equal(retried.reapEventSeq, settled.reapEventSeq);
  assert.equal(retried.dispositionDigest, settled.dispositionDigest);

  assert.throws(() => store.elevateTaskScratchpad(
    { ...request, entryIds: [second.entry.entryId] }, orchestratorAuth('sp4:retry:elevate'),
  ), (error) => error?.code === 'scratchpad_settlement_conflict');
});

test('SP4: maximum valid groups stay under MAX_SCRATCHPAD_BATCH_BYTES', () => {
  assert.equal(MAX_SCRATCHPAD_BATCH_BYTES, 2 * 1024 * 1024);
  // A maximum worker settlement is 128 elevations + 128 bridge facts + one reap. Every
  // elevation is commitment-only (rule 10: no repeated prose), so the arithmetic must fit.
  const perElevation = canonicalBytes({
    schemaVersion: 1, runId, scope: 'shared',
    sourceEntryId: `scratchpad-entry:${'a'.repeat(64)}`, sourceEntryDigest: 'b'.repeat(64),
    sourceEvent: 999_999, entryId: `scratchpad-entry:${'c'.repeat(64)}`,
    entryDigest: 'd'.repeat(64), contentDigest: 'e'.repeat(64), kind: 'note',
    scratchFactId: `scratch-fact:${'f'.repeat(64)}`,
  });
  const perReapRow = canonicalBytes({
    entryId: `scratchpad-entry:${'a'.repeat(64)}`, entryDigest: 'b'.repeat(64),
    result: 'elevated', targetId: `scratchpad-entry:${'c'.repeat(64)}`, reasonCode: 'selected',
  });
  const projected = (perElevation * 2 * MAX_SCRATCHPAD_WORKER_ENTRIES)
    + (perReapRow * MAX_SCRATCHPAD_WORKER_ENTRIES);
  assert.ok(projected < MAX_SCRATCHPAD_BATCH_BYTES,
    `a maximum task settlement (${projected}B) must fit the 2MiB batch ceiling`);
});

// ===========================================================================
// SP5 — fenced, non-evented reads
// ===========================================================================

test('SP5: repeated snapshot and projection polls append nothing and move no fence', () => {
  const store = freshStore('sp5-nonevented');
  write(store, { key: 'sp5:seed' });
  const before = {
    lastSeq: store.snapshot().lastSeq,
    events: store._events.length,
    workerFence: store.scratchpadFence(runId, `worker:${workerA}`),
    sharedFence: store.scratchpadFence(runId, 'shared'),
  };
  const cache = new Map();
  const viewer = { role: 'worker', workerId: workerA };
  for (let poll = 0; poll < 5; poll += 1) {
    store.scratchpadSnapshot(runId, `worker:${workerA}`);
    store.scratchpadSnapshotBatch(runId, [`worker:${workerA}`, 'shared']);
    projectScratchpadView(store.scratchpadSnapshotBatch(runId, [`worker:${workerA}`, 'shared']), viewer, cache);
  }
  assert.deepEqual({
    lastSeq: store.snapshot().lastSeq,
    events: store._events.length,
    workerFence: store.scratchpadFence(runId, `worker:${workerA}`),
    sharedFence: store.scratchpadFence(runId, 'shared'),
  }, before, 'a scratchpad poll is pure');
});

test('SP5: an unchanged fence tuple returns the exact same frozen projection identity', () => {
  const store = freshStore('sp5-cache');
  write(store, { key: 'sp5:cache:1' });
  const cache = new Map();
  const viewer = { role: 'worker', workerId: workerA };
  const scopes = [`worker:${workerA}`, 'shared'];
  const first = projectScratchpadView(store.scratchpadSnapshotBatch(runId, scopes), viewer, cache);
  const cached = projectScratchpadView(store.scratchpadSnapshotBatch(runId, scopes), viewer, cache);
  assert.equal(first, cached, 'the exact cached projection is served while the tuple is unchanged');

  write(store, { key: 'sp5:cache:2' });
  const recomputed = projectScratchpadView(store.scratchpadSnapshotBatch(runId, scopes), viewer, cache);
  assert.notEqual(recomputed, first, 'a fence advance is the only thing that recomputes');
  assert.ok(Object.isFrozen(recomputed));
});

test('SP5: one batch capture yields one observedSeq across every requested scope', () => {
  const store = freshStore('sp5-batch');
  settleTaskWith(store, [noteEntry('shared row')]);
  write(store, { worker: workerB, task: taskB, entry: noteEntry('private row'), key: 'sp5:batch:b' });
  const capture = store.scratchpadSnapshotBatch(runId, [`worker:${workerB}`, 'shared']);
  assert.equal(capture.observedSeq, store.snapshot().lastSeq);
  assert.deepEqual(capture.fenceTuple, [
    [`worker:${workerB}`, store.scratchpadFence(runId, `worker:${workerB}`)],
    ['shared', store.scratchpadFence(runId, 'shared')],
  ]);
  assert.deepEqual(capture.slices.map((slice) => slice.scope), [`worker:${workerB}`, 'shared']);
});

test('SP5: a mismatched expectedFenceTuple refuses before any entry slice is returned', () => {
  const store = freshStore('sp5-cursor');
  write(store, { key: 'sp5:cursor' });
  const scopes = [`worker:${workerA}`];
  const good = store.scratchpadSnapshotBatch(runId, scopes).fenceTuple;
  assert.doesNotThrow(() => store.scratchpadSnapshotBatch(runId, scopes, { expectedFenceTuple: good }));
  write(store, { key: 'sp5:cursor:2' });
  assert.throws(() => store.scratchpadSnapshotBatch(runId, scopes, { expectedFenceTuple: good }),
    (error) => error?.code === 'scratchpad_cursor_stale');
});

test('SP5: a write, an elevation, and a reap each advance exactly one scope fence', () => {
  const store = freshStore('sp5-fences');
  registerSteering(store);
  const workerScope = `worker:${workerA}`;
  const beforeWrite = [store.scratchpadFence(runId, workerScope), store.scratchpadFence(runId, 'shared')];
  const written = write(store, { entry: noteEntry('fence me'), key: 'sp5:fence:1' });
  const afterWrite = [store.scratchpadFence(runId, workerScope), store.scratchpadFence(runId, 'shared')];
  assert.deepEqual(afterWrite, [beforeWrite[0] + 1, beforeWrite[1]], 'a worker write moves only its own scope');

  store.elevateTaskScratchpad({
    runId, taskId: taskA, workerId: workerA,
    expectedScratchpadFence: afterWrite[0], entryIds: [written.entry.entryId],
  }, orchestratorAuth('sp5:fence:elevate'));
  const afterSettle = [store.scratchpadFence(runId, workerScope), store.scratchpadFence(runId, 'shared')];
  assert.equal(afterSettle[1], afterWrite[1] + 1, 'the elevation advanced shared');
  assert.equal(afterSettle[0], afterWrite[0] + 1, 'the reap advanced the reaped worker scope');
});

test('SP5: legacy readScratch still appends scratch.read — the named anti-precedent is untouched', () => {
  const store = freshStore('sp5-legacy');
  const envRef = { repoId, treeSha };
  store.postScratchFact({
    grounding: 'observed', namespace: 'ordinary', key: 'ordinary:k', resource: 'ordinary:k', envRef,
  }, orchestratorAuth('sp5:legacy:fact'));
  const before = store._events.length;
  store.readScratch('ordinary:k', envRef, { readerActor: 'worker', taskId: taskA }, orchestratorAuth('sp5:legacy:read'));
  assert.equal(store._events.length, before + 1);
  assert.equal(store._events.at(-1).kind, 'scratch.read',
    'legacy Scratch keeps its evented read; the scratchpad deliberately does not copy it');
});

test('SP5 (v2 R33R-6): no scratchpad fold or read scans the whole ledger', () => {
  const store = freshStore('sp5-noscan');
  for (let index = 0; index < 16; index += 1) write(store, { entry: noteEntry(`row ${index}`), key: `sp5:scan:${index}` });

  let eventsTouched = 0;
  const realEvents = store._events;
  const instrumented = new Proxy(realEvents, {
    get(target, property, receiver) {
      if (property === 'filter' || property === 'find' || property === 'forEach'
        || property === 'map' || property === 'slice' || property === 'some') eventsTouched += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  Object.defineProperty(store, '_events', { value: instrumented, configurable: true, writable: true });
  store.scratchpadSnapshotBatch(runId, [`worker:${workerA}`, 'shared']);
  write(store, { entry: noteEntry('folded without a scan'), key: 'sp5:scan:fold' });
  Object.defineProperty(store, '_events', { value: realEvents, configurable: true, writable: true });

  assert.equal(eventsTouched, 0, 'reads and folds use the per-scope index, never a full ledger scan');
});

test('SP5 (v2 R33R-6): workflow settle, Run close, and Run stop purge every cache key for that Run', () => {
  const cache = new Map([
    [`${runId}\0worker\0${workerA}\0`, { runId }],
    [`${runId}\0orchestrator\0\0`, { runId }],
    ['run-other\0worker\0w-other\0', { runId: 'run-other' }],
  ]);
  for (const trigger of ['workflow_settled', 'run_closed', 'run_stopped']) {
    const copy = new Map(cache);
    assert.equal(purgeScratchpadViewCache(copy, runId, trigger), 2);
    assert.deepEqual([...copy.keys()], ['run-other\0worker\0w-other\0']);
  }
});

// ===========================================================================
// SP6 — visibility and driver steering
// ===========================================================================

test('SP6: worker slices are own+shared while an orchestrator sees every requested scope', () => {
  const store = freshStore('sp6-visibility');
  const own = write(store, { worker: workerA, task: taskA, entry: noteEntry('alpha private'), key: 'sp6:a' });
  write(store, { worker: workerB, task: taskB, entry: doubtEntry('beta private?'), key: 'sp6:b' });
  const cache = new Map();
  const capture = store.scratchpadSnapshotBatch(
    runId, [`worker:${workerA}`, `worker:${workerB}`, 'shared'],
  );
  const alpha = projectScratchpadView(capture, { role: 'worker', workerId: workerA }, cache);
  const beta = projectScratchpadView(capture, { role: 'worker', workerId: workerB }, cache);
  const driver = projectScratchpadView(capture, { role: 'orchestrator' }, cache);

  assert.deepEqual(alpha.scopes, [`worker:${workerA}`, 'shared']);
  assert.deepEqual(beta.scopes, [`worker:${workerB}`, 'shared']);
  assert.equal(alpha.entries.length, 1);
  assert.equal(alpha.entries[0].entryId, own.entry.entryId);
  assert.equal(beta.entries.length, 1);
  assert.equal(driver.entries.length, 2);
  assert.equal(alpha.entries.some((entry) => entry.scope === `worker:${workerB}`), false);
});

test('SP6: every driver-facing entry is the closed rule-16 shape', () => {
  const store = freshStore('sp6-shape');
  write(store, { entry: planEntry(), key: 'sp6:shape' });
  const view = projectScratchpadView(
    store.scratchpadSnapshotBatch(runId, [`worker:${workerA}`, 'shared']),
    { role: 'worker', workerId: workerA },
  );
  assert.equal(view.entries.length, 1);
  assert.deepEqual(Object.keys(view.entries[0]).sort(), [
    'authorTaskId', 'authorWorkerId', 'candidateState', 'content', 'contentDigest', 'createdAt',
    'createdEvent', 'entryDigest', 'entryId', 'kind', 'ordinal', 'runId', 'schemaVersion',
    'scope', 'source',
  ]);
  assert.equal(view.entries[0].candidateState, 'candidate');
  assert.equal(view.entries[0].source, null);
  assert.equal(view.entries[0].ordinal, 1);
});

test('SP6 (v2 R33R-6): the historical positive path retains scratchpad when ownership resolves', async () => {
  const { BatonApplication } = await import('../src/application.mjs');
  assert.match(BatonApplication.prototype._historicalProfileView.toString(),
    /scratchpad/u, 'the resolvable historical profile path must project the additive field');
});

// ===========================================================================
// SP7 — F14 sanitization and provenance
// ===========================================================================

test('SP7: every worker-authored string is sanitized and provenance-marked', () => {
  const store = freshStore('sp7-sanitize');
  const credential = 'api_key=abcdefghijklmnop';
  const receipts = [
    write(store, { entry: noteEntry(credential), key: 'sp7:note' }),
    write(store, {
      entry: {
        kind: 'plan', objective: credential,
        steps: [{ text: credential, state: 'doing' }], supersedes: null,
      },
      key: 'sp7:plan',
    }),
    write(store, {
      entry: { kind: 'doubt', question: credential, context: credential },
      key: 'sp7:doubt',
    }),
    write(store, {
      entry: linkEntry({ type: 'repo_path', path: `impl/${credential}` }, 'reference', credential),
      key: 'sp7:link',
    }),
  ];
  const view = projectScratchpadView(
    store.scratchpadSnapshotBatch(runId, [`worker:${workerA}`]),
    { role: 'worker', workerId: workerA },
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(credential), false);
  assert.ok(serialized.includes('[credential-shaped content redacted]'));
  for (const entry of view.entries) {
    assert.equal(entry.entryDigest, receipts.find((row) => row.entry.entryId === entry.entryId).entry.entryDigest);
  }
  const prose = view.entries.flatMap((entry) => {
    if (entry.kind === 'note') return [entry.content.text];
    if (entry.kind === 'plan') return [entry.content.objective, ...entry.content.steps.map((step) => step.text)];
    if (entry.kind === 'doubt') return [entry.content.question, entry.content.context];
    return [entry.content.label, entry.content.target.path];
  }).filter(Boolean);
  for (const value of prose) {
    assert.deepEqual(value, {
      worker: workerA, text: '[credential-shaped content redacted]',
      provenance: 'model-authored', untrusted: true,
    });
  }
});

test('SP7: createScratchpadEntry exposes only the exact typed content projection', () => {
  const row = createScratchpadEntry({
    schemaVersion: 1, entryId: `scratchpad-entry:${'a'.repeat(64)}`,
    entryDigest: 'b'.repeat(64), contentDigest: 'c'.repeat(64), runId,
    scope: `worker:${workerA}`, authorWorkerId: workerA, authorTaskId: taskA,
    ordinal: 1, kind: 'note', createdEvent: 1, createdAt: STORE_CLOCK_ISO,
    candidateState: 'candidate', source: null,
    content: { kind: 'note', text: { worker: workerA, text: 'safe', provenance: 'model-authored', untrusted: true } },
  });
  assert.ok(Object.isFrozen(row));
  assert.equal(row.content.kind, 'note');
});

// ===========================================================================
// SP8 — continuous candidacy and task settle
// ===========================================================================

test('SP8: settlement preserves candidate authorship/source and binds exact dispositions', () => {
  const store = freshStore('sp8-settle');
  const { written, elevation } = settleTaskWith(store, [noteEntry('keep'), doubtEntry('drop?')], {
    selected: [],
  });
  assert.equal(elevation.result, 'settled');
  const reap = store.snapshot().scratchpad.reaps.at(-1);
  assert.equal(reap.dispositions.length, 2);
  assert.ok(reap.dispositions.every((row) =>
    row.result === 'not_elevated' && row.reasonCode === 'orchestrator_skipped' && row.targetId === null));
  assert.deepEqual(reap.dispositions.map((row) => row.entryId).sort(),
    written.map((row) => row.entry.entryId).sort());
  assert.equal(reap.dispositionDigest, canonicalDigest(reap.dispositions));
});

test('SP8 (v2 R33R-3/R33R-6): bridge treeBinding honestly falls back to task_base', () => {
  const store = freshStore('sp8-tree');
  settleTaskWith(store, [noteEntry('basis')]);
  const fact = store.snapshot().scratch.facts.find((row) => row.namespace === 'scratchpad');
  assert.equal(fact.value.treeBinding, 'task_base');
  assert.equal(fact.envRef.treeSha, treeSha);
});

test('SP8 (v2 R33R-3): coordinator terminal observation covers verified, failed, and cancelled tasks', async () => {
  const { Coordinator } = await import('../src/coordinator.mjs');
  const source = Coordinator.prototype._settleTerminalScratchpad.toString();
  for (const status of ['completed', 'failed', 'cancelled']) assert.ok(source.includes(status));
  assert.ok(source.includes('terminalCaptureSha'));
});

// ===========================================================================
// SP9 — qualification and unchanged promotion path
// ===========================================================================

test('SP9: an exact link to a bridged shared note atomically records one marked scratch.read', () => {
  const store = freshStore('sp9-citation');
  const { elevation } = settleTaskWith(store, [noteEntry('cite me')]);
  const target = elevation.elevated[0];
  const before = store._events.length;
  write(store, {
    worker: workerB, task: taskB, key: 'sp9:link',
    entry: linkEntry({
      type: 'entry', entryId: target.sharedEntryId, entryDigest: target.sharedEntryDigest,
    }, 'contradicts'),
  });
  const group = store._events.slice(before);
  assert.deepEqual(group.map((event) => event.kind), ['scratchpad.entry_written', 'scratch.read']);
  assert.ok(group.every((event) => event.batch.kind === 'scratchpad_link_citation'));
  assert.equal(group[1].payload.readerActor, 'scratchpad.link');
  assert.equal(group[1].payload.citationRelation, 'contradicts');
  assert.equal(group[1].payload.targetEntryId, target.sharedEntryId);
});

// ===========================================================================
// SP10 — KG-2 gate and workflow reap
// ===========================================================================

test('SP10: workflow settlement atomically reaps shared entries and expires bridge facts', () => {
  const store = freshStore('sp10-workflow');
  settleTaskWith(store, [noteEntry('workflow note'), planEntry('workflow plan')]);
  const before = store._events.length;
  const receipt = store.settleWorkflowScratchpad({
    runId, expectedScratchpadFence: store.scratchpadFence(runId, 'shared'), skips: [],
  }, orchestratorAuth('sp10:settle'));
  assert.equal(receipt.result, 'settled');
  assert.equal(store.scratchpadSnapshot(runId, 'shared').entries.length, 0);
  assert.ok(store.snapshot().scratch.facts.every((fact) => !fact.active));
  const group = store._events.slice(before);
  assert.equal(group[0].kind, 'scratchpad.partition_reaped');
  assert.equal(group[0].batch.kind, 'scratchpad_workflow_settlement');
  assert.ok(group.slice(1).every((event) => event.kind === 'scratch.fact_expired'));
});

// ===========================================================================
// SP11 — run-stop guard and cleanup
// ===========================================================================

test('SP11: stop cleanup is policy-only, ordered worker partitions first and shared last', () => {
  const store = freshStore('sp11-stop');
  write(store, { worker: workerB, task: taskB, key: 'sp11:b' });
  settleTaskWith(store, [noteEntry('shared')]);
  store._runStopByTarget.set(runId, { runId, status: 'stopping' });
  const receipt = store.reapRunScratchpads(runId);
  assert.equal(receipt.result, 'complete');
  assert.deepEqual(receipt.reaped.map((row) => row.scope), [`worker:${workerB}`, 'shared']);
  assert.equal(receipt.remainingPartitions, 0);
  assert.equal(receipt.remainingEntries, 0);
  assert.equal(receipt.remainingBridgeFacts, 0);
  assert.ok(store._events.filter((event) => event.batch?.kind === 'scratchpad_stop_cleanup')
    .every((event) => event.actor === 'policy'));
});

test('SP11: a zero-residue stop retry is a no-event complete receipt', () => {
  const store = freshStore('sp11-empty');
  store._runStopByTarget.set(runId, { runId, status: 'stopping' });
  const before = store._events.length;
  const receipt = store.reapRunScratchpads(runId);
  assert.deepEqual(receipt, {
    ok: true, result: 'complete', runId, reaped: [], nextPartition: null,
    remainingPartitions: 0, remainingEntries: 0, remainingBridgeFacts: 0,
  });
  assert.equal(store._events.length, before);
});

// ---------------------------------------------------------------------------
// SP-issue48 — the emulated up-channel admits expectedFence:'current' (the fence-chase
// erratum: prose workers cannot observe the turn fence, and every steering event advances
// it — numeric fences are unwritable for them, 0/24 in the demo). The scanner row pins the
// grammar here; the admission-level row lives in the wave-driver-policy suite (D11), whose
// harness builds Run-bound workers through the full application ceremony.
test("SP-issue48: the prose scanner accepts 'current' and only the closed shape", async () => {
  const { scanForScratchpadWrite } = await import('../src/claude-session.mjs');
  const accepted = scanForScratchpadWrite('SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"hello"},"expectedFence":"current","idempotencyKey":"i48:scan"}');
  assert.ok(accepted, "the scanner must accept 'current'");
  assert.equal(accepted.expectedFence, 'current');
  assert.equal(scanForScratchpadWrite('SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"hello"},"expectedFence":"sometimes","idempotencyKey":"i48:scan"}'), null);
  assert.equal(scanForScratchpadWrite('SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"hello"},"expectedFence":-1,"idempotencyKey":"i48:scan"}'), null);
});
