// Issue #454 — `SwarmRuntime.inspect` is a projection, and a projection does not reconcile.
//
// The seam classifier read `inspect`'s head as recovery because it called
// `_reconcileParticipantRuntimes()`, while the committed audit pin (SI5) records that `inspect` is
// observation. The fact is what that call DOES: it writes the durable `swarm.participant_runtime_lost`
// fold (#364), so it is a restart path, and the read path was performing recovery work. The repair
// is placement, not naming and never the pin: the fold runs at the runtime entry every command
// already passes through (`_dispatch`, which the #364 lane called in the same commit it added the
// `inspect` call), and the read path projects the state that entry reconciled.
//
// Pinned here against a REAL reopened driver (the #383/#434 restart, never a hand-built
// projection): a standalone `inspect` on a swarm whose seat lost its worker with the old
// incarnation writes no fold row and mints nothing to the ledger, while the same swarm's
// `swarm.view` — the entry, then the projection — still folds exactly one and reads it.
//
// The #442 provider-fault observation deliberately stays ON the read path, and it is not the same
// fact: a provider death arrives while the resident is up (a bounded watch wakes on one), so a
// frame that could not fold it would project a dead seat as live. issue442-*.test.mjs pins that
// row; the #364 reconcile has no such posture because its fleet is captured once at startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue454-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue454@example.invalid', GIT_COMMITTER_EMAIL: 'issue454@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'issue454', GIT_COMMITTER_NAME: 'issue454' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const logDir = join(root, 'deployment');
  mkdirSync(logDir, { recursive: true });
  return { root, repo, logDir };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });
const seatBrief = (label) => createBrief({
  goal: label, constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

/** ONE incarnation: a real driver over the shared repository + deployment root, and the swarm
 * runtime the deployment builds over it (the `_swarmRuntime` wiring in application.mjs). The
 * seats' runs are spawned through the coordinator itself, so the replayed worker handle a second
 * incarnation sees is the one this incarnation really created. */
function incarnation(f, { label = 'i' } = {}) {
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'issue454-repo', logDir: f.logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) },
  });
  const runtime = new SwarmRuntime({
    store: driver.coordination,
    coordinator: driver.coordinator,
    authorize: async () => {},
    prepareRun: async () => ({}),
    lastCrash: () => null,
    startRun: async (request) => {
      const handle = await driver.coordinator.spawn('mock', seatBrief(request.participantId), {
        taskId: request.runId, runId: request.runId,
      });
      return { runId: request.runId, workerId: handle.id };
    },
  });
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'view' ? {} : { idempotencyKey: `${label}-${command}-${++keys}` }),
    ...args,
  }, owner);
  return { driver, runtime, call };
}

const close = async (incarnationRow) => {
  try { await incarnationRow.driver.drainAndClose('issue454:test'); }
  catch { try { incarnationRow.driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
};

const lostRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'swarm.participant_runtime_lost');
const participantRow = (view, participantId) =>
  view.participants.find((row) => row.participantId === participantId) ?? null;

/** A second incarnation whose replayed seat is bound to a worker the recovered fleet does not
 * contain — the #364 loss this file needs, reached through a real close + reopen. */
async function restartedWorld(label) {
  const f = world(label);
  const first = incarnation(f, { label: `${label}1` });
  await first.call('create', { swarmId: 'sw', purpose: 'A projection does not reconcile' });
  await first.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  const bound = first.driver.coordination.swarm('sw').participants.alpha;
  assert.equal(bound.status, 'active', 'the seat is a live member of the first incarnation');
  await close(first);

  const second = incarnation(f, { label: `${label}2` });
  const lostWorkerId = bound.bindings.at(-1).workerId;
  assert.equal(lostRows(second.driver.coordination).length, 0,
    'the reopened incarnation has folded nothing yet — no command has run');
  return { second, lostWorkerId, f };
}

test('454-a: the read path records no fold row and mints nothing to the ledger', async (t) => {
  const { second, lostWorkerId } = await restartedWorld('a');
  t.after(() => close(second));
  const store = second.driver.coordination;

  // THE READ PATH ALONE: `inspect` is what a `swarm.view` calls to project, entered here directly
  // so the entry's reconciliation cannot have run first.
  const headBefore = store.ledgerHeadSeq();
  const projected = second.runtime.inspect(store.swarm('sw'), owner, null);
  assert.equal(lostRows(store).length, 0,
    'the read path writes no `swarm.participant_runtime_lost` fold — the reconcile is the entry\'s');
  assert.equal(store.ledgerHeadSeq(), headBefore,
    'a projection mints nothing at all: not the fold row, not any other row');
  // The projection answers from the rows as folded, which is what the entry owns: entered without
  // that pass it does not invent the reconciliation, so the replayed handle still reads live-
  // bearing — the state the #364 entry folds away on every command.
  assert.equal(participantRow(projected, 'alpha').runtime.live, true,
    'the read projects the reconciled state; it does not perform the reconciliation');
  assert.equal(participantRow(projected, 'alpha').runtime.workerId, lostWorkerId);
});

test('454-b: the runtime entry still folds the lost seat, and the view reads it', async (t) => {
  const { second, lostWorkerId } = await restartedWorld('b');
  t.after(() => close(second));
  const store = second.driver.coordination;

  const view = await second.call('view', { swarmId: 'sw' });
  const rows = lostRows(store);
  assert.equal(rows.length, 1, 'the lifecycle seam still folds ONE row per lost seat');
  assert.equal(rows[0].payload.participantId, 'alpha');
  assert.equal(rows[0].payload.workerId, lostWorkerId);
  assert.deepEqual(participantRow(view, 'alpha').runtime,
    { workerId: lostWorkerId, state: 'dead', turn: null, live: false },
    'the projection reads the state the entry reconciled');
  assert.ok(view.attention.some((row) => row.kind === 'worker_lost_on_restart'
    && row.participantId === 'alpha'), 'the folded seat still pages');

  // One row per loss, however many reads project it: the entry pass is idempotent and the reads
  // add nothing.
  const head = store.ledgerHeadSeq();
  await second.call('view', { swarmId: 'sw' });
  second.runtime.inspect(store.swarm('sw'), owner, null);
  assert.equal(lostRows(store).length, 1, 'no read mints a second fold row');
  assert.equal(store.ledgerHeadSeq(), head, 'a later view and a direct read append nothing');
});
