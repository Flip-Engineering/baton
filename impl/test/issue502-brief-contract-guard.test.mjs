// Issue #502 — a brief's free-text field names can contradict the real contribution contract,
// and the recruit path reads the objective before any seat is admitted on it.
//
// The #492 audit swarm's operator-written brief told every auditor lane to report its results in
// a `findings` array beside the contract's own keys. The contract has no `findings` field, so 40
// of the swarm's 46 `swarm.operation_refused` rows were the identical
// `body.findings: unknown-field` refusal; 17 of 18 finished seats met it at least once, one
// thirteen times. The guardrail (#310, #371) — the worked example every brief renders — sits in
// the brief's own contract section, and no surface read the recruiter's text that contradicted it.
//
// The repair: `contributionContractConflict` lints one free-text objective. A JSON-ish object
// that names at least two of the contract's own top-level fields is read as an example OF the
// contribution body; the first field name in it (or in an object nested inside it) that the
// contract does not admit is refused at recruit, before any effect, naming the field, the
// admitted vocabulary and where the content belongs.
//
// Red-before: row (d) recruits the objective recorded on the real #492 brief. Before this change
// that recruit is admitted and the seat meets the wall at its first publish; with the guard the
// same recruit refuses `swarm_command_invalid {field: objective, rule: contract-field}` and the
// seat is never created.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CONTRIBUTION_CONTRACT_EXAMPLE, CONTRIBUTION_CONTRACT_SCHEMA,
  contributionContractBriefSection, contributionContractConflict, contributionContractExample,
} from '../src/contribution-contract.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue502-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const prepareRuns = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    prepareRun: async (request) => { prepareRuns.push(request); },
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
  return { store, runtime, workers, prepareRuns, call };
}

const refusalRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');

/** The body example the #492 audit swarm's brief carried (trimmed from the recorded brief): the
 * contract's own keys plus a top-level `findings` array holding per-finding detail. */
const FAILING_OBJECTIVE = [
  'You are a read-only auditor lane in swarm swarm-limits-audit-20260918, sweeping ONE region of the',
  'Baton codebase for issue #492: arbitrary hardcoded numeric limits acting as control flow.',
  '',
  'WHEN DONE publish ONE contribution:',
  'node "$BATON_SWARM_CLIENT" swarm.update \'{"event":"swarm.contribution_recorded","payload":{"body":<BODY>}}\'',
  'where <BODY> is ONE JSON object (read-only seat: commit MUST be null):',
  '{',
  '  "subject": "audit <region>: <N> boundaries audited, <N> picked",',
  '  "base": {"observedHead": "c85bd9e38168dfb78f523446d9fa3ebf21eb6dc7", "rebasedOnto": "c85bd9e38168dfb78f523446d9fa3ebf21eb6dc7"},',
  '  "commit": null,',
  '  "items": [{"id": "audit-<region>", "status": "delivered", "change": "Read-only numeric-limits audit of <region>", "files": [<your region files>], "test": "read-only audit; no tests run", "evidence": "<one-line summary of the worst finding>"}],',
  '  "verification": {"targeted": false, "gates": [], "fullSuite": false, "environmentRed": []},',
  '  "carriedForward": [],',
  '  "needsFromOthers": [],',
  '  "findings": [',
  '    {"file": "impl/src/x.mjs", "line": 123, "constant": "MAX_FOO = 5000", "severity": "high"}',
  '  ]',
  '}',
].join('\n');

/** The same objective with the per-finding detail folded into items[].evidence — the shape the
 * contract admits, and the fix an orchestrator makes once the refusal names the field. */
const FIXED_OBJECTIVE = FAILING_OBJECTIVE
  .replace('"evidence": "<one-line summary of the worst finding>"',
    '"evidence": "<severity, file, line, literal, gates, and why it looks picked>"')
  .replace(/\n  "findings": \[[\s\S]*?\n  \]\n/u, '\n');

/** Every field name the schema admits anywhere, walked from the schema the validator reads. */
const schemaFieldNames = (() => {
  const names = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    for (const [name, child] of Object.entries(node.fields ?? {})) { names.add(name); walk(child); }
    walk(node.items);
  };
  walk(CONTRIBUTION_CONTRACT_SCHEMA);
  return [...names];
})();

test('#502 (a) the real failing objective is read as naming body.findings', () => {
  const conflict = contributionContractConflict(FAILING_OBJECTIVE);
  assert.equal(conflict?.field, 'findings', 'the field the swarm was refused on is the one the lint names');
  assert.ok(conflict.admitted.includes('items'),
    'the answer names the admitted vocabulary, so the recruiter knows where the detail belongs');
  // The inner example object is one level down and holds `file` where the contract says `files`;
  // the first offending name in document order is what the refusal reads.
  assert.equal(contributionContractConflict('{"subject": "s", "base": {}, "items": [{"file": "x"}]}')?.field,
    'file', 'a nested example object is judged through the body that claims the contract');
});

test('#502 (b) the contract\'s own vocabulary never conflicts with itself', () => {
  assert.deepEqual(contributionContractConflict(contributionContractBriefSection()), null,
    'the brief section the recruit path renders is clean');
  assert.deepEqual(contributionContractConflict(JSON.stringify(CONTRIBUTION_CONTRACT_EXAMPLE, null, 2)), null,
    'the worked example the brief prints is clean');
  for (const name of schemaFieldNames) {
    const body = { subject: 's', items: [], [name]: 'x' };
    assert.equal(contributionContractConflict(JSON.stringify(body)), null,
      `${name} is admitted by the schema, so it is admitted by the lint`);
  }
  assert.equal(contributionContractConflict('{"subject": "s", "items": [], "findings": []}')?.field, 'findings',
    'a name outside the schema is refused');
});

test('#502 (c) texts that do not present a contribution body are left alone', () => {
  const clean = [
    // The publish envelope alone: the shell line names the event wrapper, not a body.
    'node "$BATON_SWARM_CLIENT" swarm.update \'{"event":"swarm.contribution_recorded","payload":{"body":<BODY>}}\'',
    // Another payload's example sharing one ordinary word with the contract.
    'file the issue as {"subject": "a title", "labels": ["bug", "priority:high"]}',
    'the probe observation is {"kind": "route_probe", "observedAt": "2026-09-18T00:00:00.000Z", "route": {"harness": "omp"}}',
    // Prose that mentions the word without naming a field.
    'Report your findings and list every boundary you classified in evidence.',
    // A field name inside a value stays a value.
    'Publish {"subject": "s", "base": {"observedHead": "a"}, "notes": "the body said \\"findings\\": []"}',
    // The pre-#310 hand-off: `carriedForward` alone does not read as a contract body example.
    '{"contract": {"keep": true}, "carriedForward": ["the freeze holds"]}',
  ];
  for (const text of clean) {
    assert.equal(contributionContractConflict(text), null, `no conflict in: ${text.slice(0, 60)}`);
  }
});

test('#502 (d) recruiting on the failing objective refuses typed, before any effect', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the objective names fields the contract does not admit' });
  const refused = await f.call('recruit', { participantId: 'auditor', objective: FAILING_OBJECTIVE })
    .then(() => null, (error) => error);
  assert.ok(refused, 'the recruit refused');
  assert.equal(refused.code, 'swarm_command_invalid');
  assert.equal(refused.detail.field, 'objective');
  assert.equal(refused.detail.rule, 'contract-field');
  assert.equal(refused.detail.offending, 'findings');
  assert.ok(refused.detail.admitted.includes('items'), 'the admitted vocabulary rides the refusal');
  assert.match(refused.message, /findings/, 'the message names the field the recruiter must move');
  assert.match(refused.message, /items\[\]\.evidence/, 'and where the per-item detail belongs');

  // Nothing was written and nothing was started: no seat, no worker, no deployment call.
  assert.equal(f.store.swarm('baton').participants.auditor, undefined, 'no membership row survives a refusal');
  assert.equal(f.workers.length, 0, 'no worker was started');
  assert.equal(f.prepareRuns.length, 0, 'the deployment is not asked to resolve a refused recruit');
  const row = refusalRows(f.store).at(-1);
  assert.ok(row, 'the refusal is on the durable lane a watcher reads');
  assert.equal(row.payload.code, 'swarm_command_invalid');
  assert.equal(row.payload.field, 'objective');
  assert.equal(row.payload.rule, 'contract-field');
});

test('#502 (e) the fixed objective recruits, and its seat publishes the contract shape', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the objective teaches the admitted shape' });
  const recruited = await f.call('recruit', { participantId: 'auditor', objective: FIXED_OBJECTIVE,
    permissions: ['read', 'communicate', 'contribute'] });
  assert.equal(recruited.participantId, 'auditor', 'the fixed objective is admitted');
  const brief = f.store.swarm('baton').participants.auditor.brief;
  assert.ok(brief.startsWith('You are a read-only auditor lane'), 'the objective leads the brief verbatim');
  assert.ok(brief.includes('## Contribution contract'), 'the contract section still rides the brief');
  // The seat's first publish takes the admitted shape — the wall 17 seats hit is not reachable here.
  const committed = await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-502', participantId: 'auditor',
      body: contributionContractExample({ readOnly: true }) } }, principal('w-1'));
  assert.equal(committed.receipt.event.kind, 'swarm.contribution_recorded', 'the publish is admitted');
  assert.ok(f.store.swarm('baton').contributions['c-502'], 'the contribution is recorded');
});

test('#502 (f) the refusal reaches the recruiter on the native bridge with its field and vocabulary', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the recruiter reads the refusal through the bridge' });
  await f.call('recruit', { participantId: 'lead', objective: 'Recruit and review the auditors',
    permissions: SWARM_PERMISSIONS });
  const runId = f.store.swarm('baton').participants.lead.runId;
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal: caller, context }) => f.runtime.command(command, args, caller, context),
  });
  t.after(async () => { await bridge.close(); });
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'lead', runId });
  const refusal = await swarmBridgeCommand({ command: 'swarm.recruit', args: {
    swarmId: 'baton', participantId: 'auditor', objective: FAILING_OBJECTIVE,
    idempotencyKey: 'issue502-bridge-f' } },
  { env: issued.env }).then(() => null, (error) => error);
  assert.ok(refusal, 'the recruit refused through the bridge');
  assert.equal(refusal.code, 'swarm_command_invalid');
  assert.equal(refusal.detail.offending, 'findings', 'the bridge answer names the offending field');
  assert.ok(refusal.detail.admitted.includes('items'), 'and the admitted vocabulary');
  assert.match(refusal.message, /items\[\]\.evidence/, 'and where the per-item detail belongs');
});
