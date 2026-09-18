// Issue #310 — contribution reports have a contract.
//
// Every lane invented its own swarm.contribution_recorded shape (an items object, a
// Markdown table, numbered prose, a bare "test" that woke the root as if a lane had
// landed), so nothing downstream could consume them. The repair, part of the lane
// contract (#305):
//   1. a closed contribution contract (impl/src/contribution-contract.mjs), validated
//      by the runtime on the swarm.update path and rendered by the recruit brief as
//      the expected shape;
//   2. admission rules: a bare-string body is a `note` (recorded, not a contribution,
//      never waking the contribution_recorded class); an unresolvable commit.sha
//      refuses contribution_commit_unresolved; commit:null on a dirty worktree is
//      stamped uncommitted_work;
//   3. swarm.view projects each contract as rows, and the brief cites a sibling's
//      carriedForward / needsFromOthers verbatim.
//
// Red suite (green after the runtime + wake-stream change lands): every row below is
// red at HEAD.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SHA = 'a'.repeat(40);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue310-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const ports = {
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
    },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', vendor: 'mock-session' });
    },
    stopRun: async () => ({ state: 'closed' }),
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
    ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
    ...args }, caller);
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, workers, call, recruit };
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-310-lane-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'lane@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Lane'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

const contractBody = () => ({
  subject: 'Lane scope guard holds on shared checkouts',
  base: { observedHead: SHA, rebasedOnto: 'main' },
  commit: null,
  items: [{
    id: 'scope-guard', status: 'delivered', change: 'Hold the scope guard on shared checkouts',
    files: ['impl/src/scope.mjs'], test: 'node --test test/scope.test.mjs', evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

test('(a) a well-formed contribution is admitted and projected as contract rows', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Contracted contributions' });
  await f.recruit('builder');
  const body = contractBody();
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-contract', participantId: 'builder', body } }, principal('w-1'));
  assert.deepEqual(f.store.swarm('baton').contributions['c-contract'].body, body);
  const view = await f.call('view');
  const row = view.contributions.find((entry) => entry.contributionId === 'c-contract');
  assert.ok(row, 'the contribution row is projected');
  assert.equal(row.contract.subject, body.subject);
  assert.equal(row.contract.commit, null);
  assert.deepEqual(row.contract.items, [{ id: 'scope-guard', status: 'delivered' }]);
  assert.deepEqual(row.contract.verification, { targeted: true, gates: 0, fullSuite: false, environmentRed: 0 });
  assert.equal(row.contract.carriedForward, 0);
  assert.equal(row.contract.needsFromOthers, 0);
});

test('(b) a bare-string body records a note, not a contribution, and wakes no contribution_recorded class', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Notes are not contributions' });
  await f.recruit('builder');
  const before = f.store.ledgerHeadSeq();
  const recorded = await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { body: 'just a passing note' } }, principal('w-1'));
  assert.equal(recorded.kind, 'note', 'the receipt names the note kind');
  assert.deepEqual(Object.keys(f.store.swarm('baton').contributions), [],
    'no contribution row lands for a bare-string body');
  const classes = f.store.eventsView(before + 1).map((event) => wakeClassFor(event)?.wakeClass ?? null);
  assert.ok(!classes.includes('contribution_recorded'),
    'the contribution_recorded wake class does not fire for a note');
  assert.ok(classes.includes('note'), 'the note rides the note wake class');
  const view = await f.call('view');
  const note = view.contributions.find((entry) => entry.kind === 'note');
  assert.equal(note?.body, 'just a passing note', 'the note text stays readable on the view');
  assert.equal(note?.participantId, 'builder');
});

test('(c) a commit sha that does not resolve refuses with the typed code', async (t) => {
  const f = fixture(t);
  const lane = repository(t);
  await f.call('create', { purpose: 'Commit claims are verified' });
  await f.recruit('builder');
  f.workers[0].sessionContext = { worktree: lane };
  const body = { ...contractBody(), commit: { sha: 'd'.repeat(40), branch: 'baton/lane-1' } };
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-unresolved', participantId: 'builder', body } }, principal('w-1')),
  (error) => error.code === 'contribution_commit_unresolved'
    && error.detail.sha === 'd'.repeat(40) && error.detail.branch === 'baton/lane-1',
  'the refusal names the sha and the branch it did not resolve on');
  assert.equal(f.store.swarm('baton').contributions['c-unresolved'], undefined,
    'a refused commit claim records nothing');
});

test('(d) commit null on a dirty worktree stamps uncommitted_work', async (t) => {
  const f = fixture(t);
  const lane = repository(t);
  writeFileSync(join(lane, 'draft.txt'), 'uncommitted lane work\n');
  await f.call('create', { purpose: 'Uncommitted work is honest' });
  await f.recruit('builder');
  f.workers[0].sessionContext = { worktree: lane };
  const body = contractBody();
  const recorded = await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-dirty', participantId: 'builder', body } }, principal('w-1'));
  assert.equal(recorded.status, 'uncommitted_work', 'the receipt names the stamp');
  assert.equal(f.store.swarm('baton').contributions['c-dirty'].body.status, 'uncommitted_work',
    'the runtime stamps the stored body');
  const view = await f.call('view');
  const row = view.contributions.find((entry) => entry.contributionId === 'c-dirty');
  assert.equal(row.contract.status, 'uncommitted_work', 'the projection carries the stamp');
});

test('(e) a malformed item refuses naming the field', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Malformed contracts refuse' });
  await f.recruit('builder');
  const body = contractBody();
  body.items[0].status = 'done';
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-malformed', participantId: 'builder', body } }, principal('w-1')),
  (error) => error.code === 'contribution_contract_invalid' && String(error.detail?.field).includes('status'),
  'the refusal names the offending field');
  assert.equal(f.store.swarm('baton').contributions['c-malformed'], undefined,
    'a malformed contract records nothing');
});

test('(f) the successor brief cites a sibling carriedForward verbatim', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Successors read siblings' });
  await f.recruit('lead', ['read', 'communicate', 'contribute', 'organize', 'recruit']);
  const lead = principal('w-1');
  await f.recruit('alpha', undefined, lead);
  const body = { ...contractBody(),
    carriedForward: ['HANDOFF-310-7 keeps the iface freeze through the next lane'],
    needsFromOthers: ['NEED-310-3 reviewer verdict on the iface freeze'] };
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-handoff', participantId: 'alpha', body } }, principal('w-2'));
  await f.recruit('bravo', undefined, lead);
  const brief = f.store.swarm('baton').participants.bravo.brief;
  assert.ok(brief.includes('carries forward: "HANDOFF-310-7 keeps the iface freeze through the next lane"'),
    'the successor brief cites the sibling carriedForward verbatim');
  assert.ok(brief.includes('needs from others: "NEED-310-3 reviewer verdict on the iface freeze"'),
    'the successor brief cites the sibling needsFromOthers verbatim');
  assert.ok(brief.includes('## Contribution contract'), 'the brief renders the expected shape');
  assert.ok(brief.includes('delivered|partial|not_delivered'),
    'the rendered shape names the closed item states');
});
