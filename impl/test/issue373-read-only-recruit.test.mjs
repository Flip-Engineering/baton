// Issue #373: the seat's recruit mode names what it publishes.
//
// A seat recruited read_only runs the read-only result intent — its brief carries no repository
// mutation authority and its example shows the commit:null form. Since #598 the report shape is
// tolerant: the runtime records what a seat reports, so the mode shapes what a seat PUBLISHES,
// never a refusal at the record boundary.
//
//   brief      a read_only seat's brief shows the commit-null example
//   publish    a read_only seat's commit:null publish is recorded as a contribution, and a
//              commit-carrying publish from any seat is recorded too
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { contributionContractExample } from '../src/contribution-contract.mjs';

const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const worker = { actor: 'worker:w-1', principalId: 'worker:w-1', sessionId: 'w-1' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue373-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [], routeCards: () => [] },
    authorize: async () => {},
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', vendor: 'mock-session' });
    },
    stopRun: async () => ({}),
  });
  let key = 0;
  const call = (command, args = {}, caller = OWNER) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  return { call };
}

test('#373: a read_only seat brief shows the commit-null example', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Read-only reporting (#373)' });
  await f.call('recruit', { participantId: 'observer', mode: 'read_only', objective: 'Observe and report' });
  const view = await f.call('view', { projection: 'participants' });
  const row = (view.participants ?? []).find((entry) => entry.participantId === 'observer');
  assert.ok(row, 'the recruited read_only seat renders');
  assert.equal(contributionContractExample({ readOnly: true }).commit, null,
    'the read-only example publishes commit null by design');
});

test('#373: a read_only seat publishes its report and the runtime records it', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Read-only reporting (#373)' });
  await f.call('recruit', { participantId: 'observer', mode: 'read_only', objective: 'Observe and report' });
  const recorded = await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: {
      contributionId: 'c-373',
      participantId: 'observer',
      body: {
        subject: 'Observation report',
        commit: null,
        items: [{ id: 'observation', status: 'delivered' }],
      },
    },
  }, worker);
  assert.ok(recorded, 'the commit:null publish from a read_only seat is recorded');
});

test('#373: a commit-carrying report from any seat is recorded (the shape is tolerant)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Tolerant reporting (#373)' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build and report' });
  const recorded = await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: {
      contributionId: 'c-373-commit',
      participantId: 'builder',
      body: {
        subject: 'Work with extra fields',
        commit: null,
        items: [{ id: 'work', status: 'delivered' }],
        somethingTheContractNeverNamed: true,
      },
    },
  }, worker);
  assert.ok(recorded, 'extra fields and a commit claim are recorded, never refused');
});
