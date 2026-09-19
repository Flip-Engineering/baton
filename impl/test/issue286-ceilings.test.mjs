// issue286-ceilings.test.mjs — issue #286 G-41: the magic ceilings stop being control mechanisms.
//
// Four literal ceilings refused work the ledger had already accepted or could physically hold:
// `ACCEPTANCE_REVOCATION_LIMITS` (a scan of a ledger projection, plus a payload size and a replay
// validation), `MAX_SCRATCHPAD_SNAPSHOT_REAPS` (the fold `shift()`ed durable receipts OUT of a
// projection rebuilt from the same ledger), `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS` (a partition
// count that bought nothing but the ability to observe `partial`) and the `budgetTokens` literal
// used as both default and ceiling. The two partition admission bounds stay, but they are now the
// deployment's own `scratchpadPartitionPolicy` instead of a bare literal.
//
// The pin is per ceiling and behavioural where behaviour exists: the reap projection keeps every
// durable receipt, the configured partition bound fires at the configured value, and the reap pass
// is bounded by the caller's recorded deadline. The two remaining ceilings are pinned by name —
// their guards were unreachable by construction (state ≤ ledger events), which is why removing them
// cannot be proven by driving them.
//
// Suite law: hermetic (mkdtemp fixture, no network) · fixed clock · no timing.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { STORE_MODULE_FILES } from './seam-member-source.mjs';

const STORE_CLOCK_ISO = '2026-09-14T00:00:00.000Z';
const repoId = 'repo-286-ceilings';
const runId = 'run-286-ceilings';
const taskId = 'task-286-ceilings';
const workerId = 'w-286';
const treeSha = '3'.repeat(40);
const auth = (key) => ({ actor: 'orchestrator', key });
const workerAuth = (worker, key) => ({ actor: 'worker', principalId: worker, key });

const dirs = [];
function freshStore(label, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), `baton-286-ceilings-${label}-`));
  dirs.push(dir);
  return new CoordinationStore(join(dir, 'coordination'), {
    repoId, deploymentBaseSha: treeSha, clock: () => STORE_CLOCK_ISO, ...options,
  });
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const canonical = (value) => (Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const noteEntry = (text) => ({ kind: 'note', text });

test('CEIL1: the acceptance-revocation scan ceilings are gone, not merely raised', () => {
  // Issue #259 slices 4-5: the revocation scan's members — and the guards that once capped it —
  // moved out of the class, so the scan reads every file the store's module scope spans.
  const sources = STORE_MODULE_FILES.map((file) => [
    file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
  ]);
  for (const removed of ['ACCEPTANCE_REVOCATION_LIMITS', 'acceptance_revocation_oversize']) {
    for (const [file, source] of sources) {
      assert.equal(source.includes(removed), false,
        `${removed} is still a control mechanism in ${file}: the revocation scan is bounded by the ledger it reads`);
    }
  }
  assert.ok(sources.some(([, source]) => /No state ceiling|No target ceiling|no payload ceiling/u.test(source)),
    'the store states WHY the scan needs no second ceiling');
});

test('CEIL2: the reap projection keeps every durable receipt (the view reports its own bound)', () => {
  const store = freshStore('reaps');
  const previousCap = 256; // the removed MAX_SCRATCHPAD_SNAPSHOT_REAPS fold ceiling
  const total = previousCap + 12;
  for (let index = 0; index < total; index += 1) {
    // A well-formed reap receipt for its own run: empty dispositions, fence 0, run_stopped basis.
    const run = `run-286-reap-${index}`;
    store._append('scratchpad.partition_reaped', {
      schemaVersion: 1, runId: run, scope: `worker:${workerId}`, taskId: run, observedFence: 0,
      dispositions: [], dispositionDigest: canonicalDigest([]), basis: 'run_stopped',
    }, { actor: 'policy', key: `reap:${index}` });
  }
  assert.equal(store._scratchpadReaps.length, total,
    'every durable reap receipt stays in the projection — the fold no longer shifts the oldest out');

  const snapshot = store.snapshot();
  assert.equal(snapshot.scratchpad.scratchpadReapsTruncated, true,
    'the VIEW still bounds what it renders, and says so');
  assert.ok(snapshot.scratchpad.reaps.length <= previousCap,
    'the view bound is a display bound, not a durable-fact bound');

  const replayed = new CoordinationStore(store.root, { repoId, clock: () => STORE_CLOCK_ISO });
  assert.equal(replayed._scratchpadReaps.length, total,
    'a fresh replay off the same ledger projects the same receipts (the projection is the ledger)');
});

test('CEIL3: the partition admission bound is the deployment policy, not a literal', () => {
  const store = freshStore('policy', { scratchpadPartitionPolicy: { workerEntries: 2, sharedEntries: 3 } });
  store.createTask({
    id: taskId, brief: { objective: 'policy bound' }, deps: [], refines: null, runId,
  }, auth('task'));
  const write = (index) => store.writeScratchpad(
    { runId, taskId, workerId, entry: noteEntry(`entry ${index}`) },
    workerAuth(workerId, `sp:policy:${index}`),
  );
  write(0);
  write(1);
  const refusal = (() => {
    try { write(2); return null; } catch (error) { return error; }
  })();
  assert.equal(refusal?.code, 'scratchpad_partition_exhausted',
    'the configured bound fires — at the configured value, not at the documented default');
  assert.equal(store._scratchpadEntriesByScope.get(`${JSON.stringify([runId, `worker:${workerId}`])}`).length, 2,
    'exactly the configured number of entries is admitted');

  assert.throws(() => freshStore('policy-invalid', {
    scratchpadPartitionPolicy: { workerEntries: 0, sharedEntries: 3 },
  }), /scratchpad partition policy is invalid/u,
  'a policy that names no positive bound is refused at construction');
});

test('CEIL4: the reap pass is bounded by the caller deadline, never a partition count', () => {
  const store = freshStore('pass');
  // One task per partition: the reap receipt is keyed by (runId, taskId, fence), so three partitions
  // of one task would collide on one key. Each task's worker writes one entry.
  for (const suffix of ['a', 'b', 'c']) {
    store.createTask({
      id: `task-286-${suffix}`, brief: { objective: `reap pass ${suffix}` }, deps: [], refines: null, runId,
    }, auth(`reap-task-${suffix}`));
    store.writeScratchpad(
      { runId, taskId: `task-286-${suffix}`, workerId: `w-${suffix}`, entry: noteEntry(`entry ${suffix}`) },
      workerAuth(`w-${suffix}`, `sp:pass:${suffix}`),
    );
  }
  const reasonDigest = 'a'.repeat(64);
  store.admitRunStop({
    schemaVersion: 1, repoId, runId, reasonDigest,
    requestDigest: canonicalDigest({ repoId, runId, reasonDigest }),
  }, { actor: 'orchestrator', key: `run.stop:${runId}` });

  const deadline = Date.parse(STORE_CLOCK_ISO);
  const partial = store.reapRunScratchpads(runId, { deadlineAt: deadline, now: () => deadline });
  assert.equal(partial.reaped.length, 1, 'a spent deadline still takes exactly one partition (progress first)');
  assert.equal(partial.result, 'partial');
  assert.equal(partial.remainingPartitions, 2);

  const rest = store.reapRunScratchpads(runId);
  assert.equal(rest.result, 'complete',
    'with no caller deadline the pass reaps every partition — there is no partition-count ceiling');
  assert.equal(rest.reaped.length, 2);
  assert.equal(rest.remainingPartitions, 0);
});

test('CEIL5: the atlas classification budget is the task\'s recorded brief, not a literal', () => {
  const source = readFileSync(new URL('../src/coordinator.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('Math.min(20_000'), false,
    'the 20_000 literal is gone from the coordinator (it was both the default and the ceiling)');
  assert.match(source, /budgetTokens: task\.brief\.budget\.tokens,/u,
    'the classification budget is derived from the task\'s own recorded brief budget');
});
