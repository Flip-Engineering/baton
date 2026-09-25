// Issue #371 — the brief teaches the contribution contract by a valid example, and every
// contract refusal names its rule and expectation.
//
// Six of sixteen audit seats hit contribution_contract_invalid on the same three fields
// (base.rebasedOnto null, verification.targeted / gates as prose) because the brief's
// contract section described the shape in words and never showed a payload that would be
// admitted — and the durable refusal row carried `field` but `rule: null` with no
// expectation. The repair:
//   1. contribution-contract.mjs exports ONE example payload its own validator admits
//      (CONTRIBUTION_CONTRACT_EXAMPLE, plus a mode function whose read-only variant
//      carries commit:null by design), assembled from the schema's own example column —
//      and the brief's contract section renders it verbatim with the closed value sets
//      derived from the same schema object the validator reads;
//   2. every contribution_contract_invalid refusal carries `rule` (type | enum |
//      sha-resolves | required | unknown-field) and `expectation` on the detail, on the
//      swarm.operation_refused row and on the bridge answer; the message reads
//      "<field>: <rule>; expected <expectation>".
//
// Red suite (green after the contract + runtime change lands): every row below is red
// at HEAD.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONTRIBUTION_CONTRACT_EXAMPLE, contributionContractExample,
  contributionContractBriefSection, validateContributionContract,
} from '../src/contribution-contract.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue371-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
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
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, workers, call, recruit };
}

const refusalRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');

test('#371 (a) the exported example passes its own validator, both modes', () => {
  assert.ok(CONTRIBUTION_CONTRACT_EXAMPLE !== undefined, 'the example is exported');
  assert.doesNotThrow(() => validateContributionContract(CONTRIBUTION_CONTRACT_EXAMPLE),
    'the contributing example is admitted');
  const readOnly = contributionContractExample({ readOnly: true });
  assert.doesNotThrow(() => validateContributionContract(readOnly),
    'the read-only example is admitted');
  assert.equal(readOnly.commit, null, 'a read-only seat publishes commit null by design');
  assert.notEqual(CONTRIBUTION_CONTRACT_EXAMPLE.commit, null,
    'the default example shows the commit object form');
});

test('#371 (b) the brief section renders the example verbatim and every closed set', () => {
  const brief = contributionContractBriefSection();
  assert.ok(brief.includes('## Contribution contract'), 'the section keeps its heading');
  assert.ok(brief.includes(JSON.stringify(CONTRIBUTION_CONTRACT_EXAMPLE, null, 2)),
    'the example payload renders verbatim as JSON');
  assert.ok(brief.includes('items[].status ∈ delivered|partial|not_delivered'),
    'the item status closed set is inline');
  assert.ok(brief.includes('verification.targeted: boolean'),
    'targeted names its admitted type');
  assert.ok(brief.includes('verification.gates: array of strings'),
    'gates names its admitted type');
  assert.ok(brief.includes('base.rebasedOnto: a sha string (or the observedHead)'),
    'rebasedOnto names its admitted values');
  assert.ok(brief.includes('commit: {sha, branch} or null'),
    'commit names both admitted forms');
  const readOnlyBrief = contributionContractBriefSection({ readOnly: true });
  assert.ok(readOnlyBrief.includes(JSON.stringify(contributionContractExample({ readOnly: true }), null, 2)),
    'a read-only seat is shown its own commit-null example');
});

test('#371 (c) a refusal on rebasedOnto null carries rule and expectation', () => {
  const body = { ...CONTRIBUTION_CONTRACT_EXAMPLE,
    base: { ...CONTRIBUTION_CONTRACT_EXAMPLE.base, rebasedOnto: null } };
  assert.throws(() => validateContributionContract(body), (error) => {
    assert.equal(error.code, 'contribution_contract_invalid');
    assert.equal(error.detail.field, 'body.base.rebasedOnto');
    assert.equal(error.detail.rule, 'type', 'the refusal names the predicate that failed');
    assert.equal(error.detail.expectation, 'a sha string (or the observedHead)',
      'the refusal names the admitted values');
    assert.match(error.message, /body\.base\.rebasedOnto: type; expected a sha string \(or the observedHead\)/,
      'the message reads "<field>: <rule>; expected <expectation>"');
    return true;
  });
});

test('#371 (d) a refusal on targeted as a string carries rule type, expectation boolean', () => {
  const body = { ...CONTRIBUTION_CONTRACT_EXAMPLE,
    verification: { ...CONTRIBUTION_CONTRACT_EXAMPLE.verification, targeted: 'yes' } };
  assert.throws(() => validateContributionContract(body), (error) => {
    assert.equal(error.code, 'contribution_contract_invalid');
    assert.equal(error.detail.field, 'body.verification.targeted');
    assert.equal(error.detail.rule, 'type');
    assert.equal(error.detail.expectation, 'boolean');
    assert.match(error.message, /body\.verification\.targeted: type; expected boolean/);
    return true;
  });
});

test('#371 (e) a refusal on gates as a string carries rule type, expectation array of strings', () => {
  const body = { ...CONTRIBUTION_CONTRACT_EXAMPLE,
    verification: { ...CONTRIBUTION_CONTRACT_EXAMPLE.verification, gates: 'run-suite on the touched files' } };
  assert.throws(() => validateContributionContract(body), (error) => {
    assert.equal(error.code, 'contribution_contract_invalid');
    assert.equal(error.detail.field, 'body.verification.gates');
    assert.equal(error.detail.rule, 'type');
    assert.equal(error.detail.expectation, 'array of strings');
    assert.match(error.message, /body\.verification\.gates: type; expected array of strings/);
    return true;
  });
});

test('#371 (f) a refused publish lands on the durable row with its rule, and the brief a seat receives carries the example', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The refusal teaches the rule' });
  await f.recruit('builder');
  // The brief the recruited seat was given carries the worked example; a read-only seat
  // gets the commit-null variant.
  const brief = f.store.swarm('baton').participants.builder.brief;
  assert.ok(brief.includes(JSON.stringify(CONTRIBUTION_CONTRACT_EXAMPLE, null, 2)),
    'the recruited brief carries the example JSON');
  await f.recruit('auditor', ['read', 'communicate']);
  const auditorBrief = f.store.swarm('baton').participants.auditor.brief;
  assert.ok(auditorBrief.includes(JSON.stringify(contributionContractExample({ readOnly: true }), null, 2)),
    'the read-only brief carries the commit-null example');

  const bad = { ...CONTRIBUTION_CONTRACT_EXAMPLE,
    base: { ...CONTRIBUTION_CONTRACT_EXAMPLE.base, rebasedOnto: null } };
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-371', participantId: 'builder', body: bad } }, principal('w-1')),
  (error) => error.code === 'contribution_contract_invalid');
  const row = refusalRows(f.store).at(-1);
  assert.ok(row, 'the refusal is on the durable lane');
  assert.equal(row.payload.code, 'contribution_contract_invalid');
  assert.equal(row.payload.field, 'body.base.rebasedOnto');
  assert.equal(row.payload.rule, 'type', 'the durable row carries the rule');
});

test('#371 (g) the bridge answer for a contract refusal carries rule and expectation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The bridge answer teaches the rule' });
  await f.recruit('alpha', SWARM_PERMISSIONS);
  const runId = f.store.swarm('baton').participants.alpha.runId;
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal: caller, context }) => f.runtime.command(command, args, caller, context),
  });
  t.after(async () => { await bridge.close(); });
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'alpha', runId });
  const bad = { ...CONTRIBUTION_CONTRACT_EXAMPLE,
    verification: { ...CONTRIBUTION_CONTRACT_EXAMPLE.verification, targeted: 'true' } };
  const refusal = await swarmBridgeCommand({ command: 'swarm.update', args: {
    swarmId: 'baton', event: 'swarm.contribution_recorded', idempotencyKey: 'issue371-bridge-g',
    payload: { contributionId: 'c-371-bridge', participantId: 'alpha', body: bad } } },
  { env: issued.env }).then(() => null, (error) => error);
  assert.ok(refusal, 'the update refused');
  assert.equal(refusal.code, 'contribution_contract_invalid');
  assert.equal(refusal.detail.rule, 'type', 'the bridge answer carries the rule');
  assert.equal(refusal.detail.expectation, 'boolean', 'the bridge answer carries the expectation');
  assert.match(refusal.message, /body\.verification\.targeted: type; expected boolean/);
});
