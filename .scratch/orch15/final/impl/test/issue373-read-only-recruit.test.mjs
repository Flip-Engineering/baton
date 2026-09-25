// Issue #373 — a read-only seat is handed two contradictory acceptance frames: the run's
// dispatch block asserts repository mutation authority and a change-mode result policy while
// the recruit brief says never edit — the run contract is not derived from the seat's
// contribution mode.
//
// The repair: `swarm.recruit` takes `mode: 'change' | 'read_only'` (default `change`, closed
// set declared once in swarm-contract's argument table). `read_only` starts the seat's run
// with the read-only result intent (#334), so the brief's dispatch block renders no repository
// mutation authority and the read-only acceptance instead, the brief's contract example is the
// read-only variant (#371), the seat's participant row and the view carry `mode`, and a
// read-only seat that records a contribution with a commit is refused
// `contribution_mode_mismatch {mode, field: 'commit', expectation: null}`.
//
// Red-before rows (green after the change lands; (b) is the no-regression pin and is green at
// HEAD by construction):
//   373-a  a read_only recruit starts a read-only run and its brief renders the read-only
//          frames (contract example commit-null, the refusal taught by name, no change-mode
//          mutation authority in the rendered dispatch block);
//   373-b  a change recruit teaches the held verbs (#503's ## Collaboration block), then the
//          contract example — no forced intent, no mode on the join;
//   373-c  a bad mode refuses closed-set naming the admitted values, and the bridge per-command
//          help lists the set;
//   373-d  a read_only seat's contribution carrying a commit refuses
//          contribution_mode_mismatch; the by-design commit-null publish is admitted;
//   373-e  the view (full and the participants projection) carries the seat's mode.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_SEAT_READ_COMMANDS, SWARM_SEAT_READ_COMMAND_NAMES, SwarmRuntime } from '../src/swarm-runtime.mjs';
import {
  SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES, validateSwarmCommand,
} from '../src/swarm-contract.mjs';
import {
  CONTRIBUTION_CONTRACT_EXAMPLE, contributionContractExample,
  contributionContractBriefSection,
} from '../src/contribution-contract.mjs';
import { renderBrief } from '../src/adapter.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue373-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const prepared = [];
  const started = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    prepareRun: async (request) => { prepared.push(request); return request; },
    startRun: async (request) => {
      started.push(request);
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', vendor: 'mock-session' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
    ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
    ...args }, caller);
  return { store, runtime, workers, prepared, started, call };
}

const refusalRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');

// The bridge path resolves from this file, never from the runner's cwd (issue372's lesson).
const BRIDGE = new URL('../src/swarm-native-bridge.mjs', import.meta.url).pathname;
const bridgeHelp = (args) => new Promise((resolve, reject) => {
  execFile(process.execPath, [BRIDGE, ...args], { timeout: 15000 },
    (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout));
});

test('#373 (a) a read_only recruit starts a read-only run and its brief renders the read-only frames', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Audit: read the world, change nothing' });
  await f.call('recruit', { participantId: 'auditor', objective: 'Audit the lanes', mode: 'read_only' });

  // The run contract derives from the seat's mode: the run starts with the read-only result
  // intent (#334) — the seam that renders the dispatch block with NO repository mutation
  // authority and the read-only acceptance instead (renderBrief reads brief.effects, and a
  // read-only run strips repository_edit from the node; issue334-6 pins the rendered text).
  const started = f.started.at(-1);
  assert.equal(started?.options?.resultIntent, 'read_only_evidence',
    'the read_only recruit starts its run read-only');
  const prepared = f.prepared.at(-1);
  assert.equal(prepared?.options?.resultIntent, 'read_only_evidence',
    'the admission resolution sees the read-only intent too');

  const brief = f.store.swarm('baton').participants.auditor.brief;
  assert.ok(brief.includes(JSON.stringify(contributionContractExample({ readOnly: true }), null, 2)),
    'the brief renders the read-only contract example');
  assert.equal(brief.includes(JSON.stringify(CONTRIBUTION_CONTRACT_EXAMPLE, null, 2)), false,
    'the contributing example never renders for a read_only seat');
  assert.match(brief, /contribution_mode_mismatch/,
    'the brief says a commit-carrying publish is refused, by name');
  assert.match(brief, /expectation: null/, 'the brief names the admitted commit form');

  // The dispatch block this run's brief value renders: effects without repository_edit (the
  // read-only run's own node effects) assert no mutation authority and state the acceptance.
  const rendered = renderBrief({
    goal: 'audit', pathScope: ['.'], effects: ['provider_call'], requiredEffects: [],
    budget: { tokens: 10, usd: 1, wallMin: 1 }, verification: { command: 'node --test', expectExit: 0 },
  }, 'cli');
  assert.equal(rendered.includes('The approved Plan requires an in-scope repository edit'), false,
    'a read_only seat is never told an edit is required');
  assert.match(rendered, /read_only_no_change/, 'the read-only acceptance is rendered instead');
});

test('#373 (b) a change recruit teaches the held verbs, then the contract example', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Change lane' });
  const objective = 'Implement the parser change';
  await f.call('recruit', { participantId: 'builder', objective });

  // Issue #503: the change brief carries the ## Collaboration block — the bridge verbs the
  // seat holds, each with the ONE situated purpose its registry row teaches. The verb lines
  // are derived here from the SAME tables, so the pin holds the composition order without
  // re-spelling a purpose.
  const collaboration = ['## Collaboration',
    'The bridge verbs you hold — each with the ONE situation it is for. Call them on your'
    + ' bridge; the permission that admits each is named, and a verb outside your grant refuses'
    + ' instead of working.',
    ...[...SWARM_KNOWLEDGE_COMMAND_NAMES, ...SWARM_SEAT_READ_COMMAND_NAMES].map((name) => {
      const row = Object.hasOwn(SWARM_KNOWLEDGE_COMMANDS, name)
        ? SWARM_KNOWLEDGE_COMMANDS[name] : SWARM_SEAT_READ_COMMANDS[name];
      return `- ${name} [${row.permission}] — ${row.situation}.`;
    })].join('\n');
  const brief = f.store.swarm('baton').participants.builder.brief;
  assert.equal(brief, `${objective}\n\n${collaboration}\n\n${contributionContractBriefSection()}`,
    'the change brief teaches the held verbs, then the contract example');
  const started = f.started.at(-1);
  assert.equal('resultIntent' in (started?.options ?? {}), false,
    'no result intent is forced onto a change recruit');
  const join = f.store.eventsView().find((event) => event.kind === 'swarm.participant_joined'
    && event.payload.participantId === 'builder');
  assert.equal('mode' in join.payload, false, 'a change recruit writes no mode onto the join');
});

test('#373 (c) a bad mode refuses closed-set naming the admitted values', async (t) => {
  assert.throws(() => validateSwarmCommand('swarm.recruit',
    { swarmId: 'baton', participantId: 'x', objective: 'y', idempotencyKey: 'k', mode: 'readonly' }),
  (error) => {
    assert.equal(error.code, 'swarm_command_invalid');
    assert.equal(error.detail.rule, 'closed-set', 'the refusal names the closed-set rule');
    assert.deepEqual([...error.detail.admitted].sort(), ['change', 'read_only']);
    assert.match(error.message, /mode must be one of: change, read_only/u);
    return true;
  }, 'the contract table refuses the bad value before any authority check');

  const f = fixture(t);
  await f.call('create', { purpose: 'The refusal teaches the set' });
  await assert.rejects(f.call('recruit', { participantId: 'seat', objective: 'Audit', mode: 'readonly' }),
    (error) => error.code === 'swarm_command_invalid' && error.detail.rule === 'closed-set');

  const help = await bridgeHelp(['swarm.recruit', '--help']);
  assert.match(help, /one of change, read_only/u, 'the bridge help lists the set');
});

test('#373 (d) a read_only seat\'s contribution carrying a commit refuses contribution_mode_mismatch', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Audit' });
  await f.call('recruit', { participantId: 'auditor', objective: 'Audit the lanes', mode: 'read_only' });

  const commitBody = { ...contributionContractExample({ readOnly: true }),
    commit: { sha: 'a'.repeat(40), branch: 'baton/auditor-1' } };
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-373-commit', participantId: 'auditor', body: commitBody } },
    principal('w-1')), (error) => {
    assert.equal(error.code, 'contribution_mode_mismatch');
    assert.deepEqual(error.detail, { mode: 'read_only', field: 'commit', expectation: null });
    return true;
  });
  const row = refusalRows(f.store).at(-1);
  assert.equal(row?.payload?.code, 'contribution_mode_mismatch', 'the refusal is on the durable lane');

  // The by-design publish is admitted: commit null, recorded as the seat's contribution.
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-373-null', participantId: 'auditor',
      body: contributionContractExample({ readOnly: true }) } }, principal('w-1'));
  const published = f.store.swarm('baton').contributions['c-373-null'];
  assert.ok(published, 'the commit-null publish is admitted');
  assert.equal(published.body.commit, null);
});

test('#373 (e) the view carries the seat\'s mode', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Mixed roster' });
  await f.call('recruit', { participantId: 'builder', objective: 'Change lane' });
  await f.call('recruit', { participantId: 'auditor', objective: 'Audit lane', mode: 'read_only' });

  const view = await f.call('view');
  const rows = new Map(view.participants.map((row) => [row.participantId, row]));
  assert.equal(rows.get('builder')?.mode, 'change', 'a change seat reads as change');
  assert.equal(rows.get('auditor')?.mode, 'read_only', 'a read_only seat reads as read_only');

  const sliced = await f.call('view', { projection: 'participants' });
  const slicedRows = new Map(sliced.participants.map((row) => [row.participantId, row]));
  assert.equal(slicedRows.get('auditor')?.mode, 'read_only',
    'the participants projection carries mode too');
});
