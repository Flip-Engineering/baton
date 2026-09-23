// runtime-api.test.mjs — issue #259, slice 13. Pins the module the coordinator's surface bucket
// moved into (impl/src/runtime-api.mjs — 46 members: 45 surface:no_authority_touched helpers plus
// _publicHandle, the caller-facing handle projection) and the coordinator that now delegates to
// it. The module is the authority-free fallback bucket (seam-map §4 finding 4), not a transport.
// Four claims are load-bearing:
//
//   1. RECEIVER DISCIPLINE — every module function's first parameter is `coordinator`; the module
//      carries NO recorder parameter and no recorder/log/coordination/adapter/process spelling —
//      no member records, so no member needs the port. Nothing but the coordinator imports the
//      module (the acyclic leaf law; see the slice-13 doc's errata for the two runtime-* imports
//      the closure required).
//   2. THE DELEGATE CENSUS — 46 delegates keep the member's name, parameter list, and arity (a
//      pre-move Function.length table), forwarding `this` and no recorder; the two async members
//      (_claimLivenessPreflight, _claimInteraction) keep plain non-async delegates with async
//      module functions (the slice-11 timing convention; the design's all-sync claim is erratum).
//   3. THE INVERSE-TRANSFORM RESIDUE — each module function, inverse-rerouted
//      (coordinator. -> this.) and relieved of its receiver parameter, is textually the delegate's
//      own member modulo the forward line; the generation-time audit against the pre-move text is
//      recorded in seam-slice-13.md.
//   4. THE MAP SEES THE MOVE — the artifact carries the runtime-api target with 47 members (the
//      46 plus canonicalActionPath, relocated with its only reader), every module member
//      classifies surface, and _publicHandle alone carries admission:policy_gate +
//      surface:transport_dispatch module-side.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeApi from '../src/runtime-api.mjs';
import { Coordinator, WorkerNotFoundError } from '../src/coordinator.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-api.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

/** The 46 moved members: delegate parameter list (the member's own) and pre-move Function.length. */
const MEMBERS = Object.freeze([
  ['_deadlineDue', '()', 0], ['supervisedProcesses', '()', 0], ['_localResourceOwnership', '(handle)', 1],
  ['providerSilenceAttention', '(workerId)', 1],
  ['_sharedCheckoutCustody', '(handle, task)', 2],
  ['_captureTrustWorktree', '(handle, task, { snapshot = false } = {})', 2],
  ['_capacityOwnerIds', '(handle, task = null)', 1], ['_capacityOwnerHeld', '(ownerTaskId)', 1],
  ['releasedResources', '()', 0], ['_drainWaitObserve', '(targetWorkerIds)', 1],
  ['_drainWaitEntry', '(resource, reaper, sinceMs)', 3], ['_capabilityRegistry', '()', 0],
  ['_poisonDeferral', '(refusal)', 1], ['_firstSaturatedCandidate', '(cards, inFlight)', 2],
  ['_inFlightCount', '(vendor)', 1], ['_harnessOf', '(vendor)', 1], ['_turnCompletionOf', '(handle)', 1],
  ['_routeAttribution', '(handle, task = this._tasks.get(handle.taskId))', 1],
  ['_gateVerdictItemForWorker', '(workerId, verdictKinds)', 2],
  ['_spillUnavailableItem', '(workerId, { refusal, beyondCap, shed })', 2],
  ['_autoTaskId', '()', 0], ['_allocWorkerId', '()', 0], ['_publicHandle', '(handle, opts = {})', 1],
  ['_getWorker', '(workerId)', 1], ['messageRunId', '(messageId)', 1],
  ['_poisonCoordination', '(err)', 1], ['_poisonIntegration', "(err, strategy = 'structured')", 1],
  ['liveWorkspaceHolders', '(physicalOwnerId, { excludeHandleId = null } = {})', 1],
  ['workspaceAttachment', '(workerId)', 1], ['predecessorWorkspaceContext', '(workspaceId)', 1],
  ['unregisterParticipantRuntime', '(runId)', 1], ['_removeRuntimeScope', '(handle)', 1],
  ['watchdogConfig', '()', 0], ['_relativeActionPath', '(handle, path)', 2],
  ['_freshTurnProgress', '(turnEpoch)', 1], ['abandonedWorkers', '()', 0],
  ['abandonedCapacityReservations', '()', 0], ['_claimInteraction', '(requestId, opts = {})', 1],
  ['_stripCapabilityPaths', '(result)', 1], ['interactionGeneration', '(taskId)', 1],
  ['decisionSettleCount', '(runId)', 1], ['_horizonCacheGet', '(kind, scopeIdentity, fenceTuple, compute)', 4],
  ['_cursorStateFile', '(workerId)', 1], ['_providerFaultOf', '(workerResult)', 1],
  ['_providerRouteOf', '(handle)', 1],
]);

const ASYNC_MEMBERS = Object.freeze(['_claimInteraction']);

test('AP1: receiver discipline — bare coordinator, no recording spelling, an acyclic leaf', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  const importSources = root.findAll({ rule: { kind: 'import_statement' } })
    .map((node) => node.field('source').text());
  for (const source of importSources) {
    assert.ok(!/coordinator\.mjs|application\.mjs/u.test(source), `one-way import violated: ${source}`);
    // Erratum (slice-13 doc §1): the closure requires pathInScope (runtime-observation) and
    // typedTerminalCode/REARM_KINDS (runtime-recovery). The acyclic invariant is the leaf law:
    // this module imports downward, and nothing imports it but the coordinator.
    assert.ok(!/runtime-admission\.mjs|runtime-effects\.mjs/u.test(source),
      `the module never imports the seam modules that sit beside the port: ${source}`);
  }
  // No recording: no recorder parameter, no log/coordination/adapter/process/fs authority
  // spelling anywhere in the module's member bodies.
  const fns = root.findAll({ rule: { kind: 'function_declaration' } })
    .filter((fn) => fn.parent().kind() === 'export_statement');
  assert.ok(fns.length > 0);
  for (const fn of fns) {
    const params = fn.field('parameters')?.text() ?? '()';
    assert.ok(params.startsWith('(coordinator') || params === '(coordinator)',
      `${fn.field('name')?.text()}: the first parameter is the bare coordinator receiver`);
    assert.ok(!/\brecorder\b/u.test(params), `${fn.field('name')?.text()}: no recorder parameter`);
  }
  // No recording: no recorder parameter, and no recording or driving spelling in the member
  // bodies. Read-only contact is fine and present: the log's .read/.dir, adapter .card() reads,
  // optional-chained coordination reads, and — named honestly — _captureTrustWorktree drives the
  // worktree capture/snapshot primitive through the receiver (the classifier's
  // no_authority_touched is a textual read of the catalogue's spellings; AP4 pins that read).
  const bodies = fns.map((fn) => fn.field('body').text()).join('\n');
  for (const forbidden of ['\\brecorder\\b', 'coordinator\\._log\\.append\\(',
    'coordinator\\._coordMapEvent\\(', 'coordinator\\._coordRecord\\(',
    'coordinator\\._coordination\\.[a-zA-Z]+\\(',
    'coordinator\\._adapters\\[[^\\]]*\\]\\.(spawn|prompt|kill|interrupt|cancel|respond|steer)\\(',
    'child_process']) {
    assert.ok(!new RegExp(forbidden, 'u').test(bodies),
      `the no-recording bucket must not carry the spelling ${forbidden}`);
  }
  // Nothing but the coordinator imports the module.
  const { execSync } = require('node:child_process');
  const importers = execSync(
    `grep -rln "runtime-api\\.mjs" ${new URL('../../impl/src', import.meta.url).pathname}`,
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
    .filter((p) => !p.endsWith('runtime-api.mjs')).sort();
  assert.deepEqual(importers.map((p) => p.split('/').pop()), ['coordinator.mjs'],
    'runtime-api.mjs is an acyclic leaf: exactly one importer');
});

test('AP2: the 46 delegates keep name, parameter list, arity, and forward this without a recorder', () => {
  const coordRoot = parseOf(read(COORD_FILE));
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const methods = new Map(cls.field('body').children()
    .filter((n) => n.kind() === 'method_definition').map((n) => [n.field('name').text(), n]));
  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { kind: 'function_declaration' } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  for (const [name, ownParams, arity] of MEMBERS) {
    const method = methods.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    assert.equal(method.field('parameters')?.text() ?? '()', ownParams,
      `${name}: the delegate keeps the member's own parameter list`);
    const moduleOwn = (memberParams.get(name) ?? '')
      .replace(/^\(coordinator,?\s*/u, '(').replaceAll('coordinator.', 'this.');
    assert.equal(ownParams, moduleOwn,
      `${name}: the module's parameter list is the member's own, receiver aside`);
    assert.ok(method.text().includes(`runtimeApi.${name}(this`),
      `${name}: the delegate hands over this and no recorder`);
    assert.ok(!method.text().includes('this._recorder'), `${name}: no recorder crosses`);
    assert.ok(!method.text().startsWith(`async ${name}(`), `${name}: plain non-async delegate`);
    assert.equal(Object.getOwnPropertyDescriptor(Coordinator.prototype, name).value.length, arity,
      `${name}: the signature must not move with the body`);
    assert.equal(typeof runtimeApi[name], 'function', `${name}: the module exports it`);
    assert.equal(/^(export )?async function/u.test(memberRoot.findAll({ rule: { kind: 'function_declaration' } })
      .find((n) => n.field('name')?.text() === name).parent().text()), ASYNC_MEMBERS.includes(name),
    `${name}: module async-ness is the member's own`);
  }
});

test('AP3: the inverse-transform residue — module bodies read as the members they were', () => {
  const memberRoot = parseOf(read(MEMBER_FILE));
  const coordText = read(COORD_FILE);
  for (const [name, ownParams] of MEMBERS) {
    const fn = memberRoot.findAll({ rule: { kind: 'function_declaration' } })
      .find((node) => node.field('name')?.text() === name);
    assert.ok(fn, `${name}: module function missing`);
    // Inverse: drop the receiver parameter, put this. back. The delegate's signature text is the
    // member's own, so the reconstructed signature must equal it modulo the async keyword.
    const inverseParams = (fn.field('parameters')?.text() ?? '()')
      .replace(/^\(coordinator,?\s*/u, '(').replaceAll('coordinator.', 'this.');
    assert.equal(inverseParams, ownParams, `${name}: the inverse signature is the member's own`);
    // The module body carries no leftover coordinator self-reference that the class body did not
    // carry as this. — the single reroute is total.
    const body = fn.field('body').text();
    assert.ok(!/\bthis\./u.test(body), `${name}: no class receiver spelling in the module body`);
    assert.ok(coordText.includes(`return runtimeApi.${name}(this`),
      `${name}: the delegate's forward line names the module function`);
  }
});

test('AP4: the map sees the move — the target carries 46 surface members, _publicHandle keeps its evidence', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-api target');
  assert.equal(target.members.length, 46,
    'the 46 moved members plus canonicalActionPath, relocated with its only reader (design erratum: 46 + 1)');
  for (const member of target.members) {
    assert.equal(member.seam, 'surface', `${member.name}: the module member keeps the surface seam`);
    if (member.name === '_publicHandle') {
      assert.ok(member.evidence.includes('admission:policy_gate')
        && member.evidence.includes('surface:transport_dispatch'),
      '_publicHandle: the policy_gate and transport_dispatch evidence follow it module-side');
    } else if (member.name !== 'canonicalActionPath') {
      assert.deepEqual(member.evidence, ['surface:no_authority_touched'],
        `${member.name}: the fallback classification is unchanged by the move`);
    }
  }
  // The coordinator's 46 delegates classify surface exactly as before (fallback, no port rule).
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const surfaceDelegates = coordinatorFile.members.filter((member) => member.seam === 'surface');
  assert.equal(surfaceDelegates.length, 45, 'the coordinator keeps 45 surface delegates');
  // The relocated class keeps the coordinator's export surface.
  assert.ok(Object.hasOwn(runtimeApi, 'WorkerNotFoundError'), 'the module exports the relocated class');
  assert.equal(WorkerNotFoundError, runtimeApi.WorkerNotFoundError,
    'the coordinator re-export resolves to the same class object');
});
