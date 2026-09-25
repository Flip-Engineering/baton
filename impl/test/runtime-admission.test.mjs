// runtime-admission.test.mjs — issue #259, slice 11. Pins the module the coordinator's admission
// bucket moved into (impl/src/runtime-admission.mjs — 89 members: the authority-op guards, the
// route/policy admission, the pause/interaction authority, and the admission-classified
// constructor) against the injected recorder port (slice 6), and the coordinator that now delegates
// to it. Five claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith, and every
//      `this` access in it belongs to the relocated classes (DependencyCycleError,
//      SupervisedProcesses); moved member bodies read the coordinator through the explicit
//      `coordinator` parameter and record through the explicit `recorder`.
//   2. SAME NAME, SAME ARITY, SAME PORT — every delegate the seam map shows as
//      `runtime_admission_port` keeps the member's own parameter list and arity and hands the
//      class's recorder to the module function. The constructor is the one exception by
//      construction: it composes the recorder, so its module function takes (coordinator, opts)
//      and its delegate is an expression statement.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — the reroute census is pinned (5 log appends, 4
//      evidence maps, 1 driver record, 29 coordination calls), and a store constructed through the
//      module function on a blank prototype behaves identically to `new`.
//   4. THE PRIMITIVES MOVED ONCE — the 19 relocated declarations are exported by the module; the
//      coordinator imports back exactly what staying code reads plus the re-exported names, and
//      `DependencyCycleError`, `SupervisedProcesses` and `guidanceSender` resolve to the same
//      objects from `coordinator.mjs` and from `index.mjs` where re-exported.
//   5. THE MAP SEES THE MOVE — the committed artifact carries the runtime-admission target with 99
//      members (89 bodies + 10 relocated helper functions), and every class delegate keeps
//      `admission`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeAdmission from '../src/runtime-admission.mjs';
import * as coordinatorModule from '../src/coordinator.mjs';
import { Coordinator } from '../src/coordinator.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-admission.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const ARITIES = Object.freeze({"constructor":1,"_assertTickable":0,"_assertReadable":0,"_withAuthorityOp":1,"_acquireAuthorityOp":0,"_trackAuthorityPromise":1,"_fleetDrainOwnsShutdown":0,"_assertOperational":0,"closeAuthority":0,"_drainFailure":1,"reopenAdmission":0,"_ownsLocalResources":1,"_hasPendingInteractionAuthority":0,"_resolveInteractionAuthority":2,"_refuseInteractionFrameId":1,"_resolvePauseAuthority":2,"_admitPauseRecord":5,"captureContribution":1,"observedNativeSubagents":1,"checkContribution":1,"_reservePauseRecord":1,"_withPauseReservation":2,"_isAuthorityCheckout":2,"_capacityWorkerGone":1,"_resolveVendor":1,"_admitResolvedVendor":1,"_selectAutoRoute":1,"_configuredCeiling":1,"_resolveExplicitRoute":1,"_semanticTargetMatches":3,"_providerCapabilityRefusal":2,"_bindStrictProviderGovernance":2,"_admitProviderTurn":3,"_admitContextPackCitations":1,"_derivePendingAttentionItems":1,"_assertAttentionPushServed":2,"_goalPlanAuth":4,"defineGoal":2,"proposePlan":2,"approvePlan":2,"goalPlanStatus":2,"preserveResult":2,"verificationRuntimeDigest":0,"_normalizeResumeRequest":1,"retryVerification":2,"materializeAcceptedResult":3,"_assertNoCycle":2,"attentionFollow":0,"_attentionScopeAuthorized":2,"guideParticipant":2,"send":3,"prepareSemanticInterrupt":1,"_resolveStopRequests":2,"_safeTurnEpoch":1,"_ensureRuntimeScope":1,"_bestEffort":2,"_bestEffortSync":2,"_noteFailure":2,"_normalizeUsage":2,"_validateTerminalUsageSeal":2,"_onStopConfirmed":2,"_sessionPreservationReceipt":2,"observeStopAbsence":1,"claimInteraction":1,"interactionStatus":1,"result":1,"capabilityCards":0,"routeCards":0,"advisoryFeedCards":0,"receiveProviderDelivery":2,"receiveProviderWebhook":2,"invokeCapability":3,"reverifyCapability":4,"invokeCapabilityNorthbound":5,"reverifyCapabilityNorthbound":6,"decideReuse":1,"recheckReuseDecision":1,"_renderCodeOrientation":1,"_answerCodeOrient":4,"admitBoardCommand":1,"admitWorkerBoardCommand":3,"admitReplManifest":2,"admitWorkflowFinding":4,"admitReplBinding":1,"list":0,"localResourceOwnership":1,"wait":0,"_queueTransientProviderTurnRetry":4,"_deriveWorkerStatus":1,"_admitSharedFanout":1,"_promoteReplObject":2,"_assertReplObjectsServed":2,"_assertReplReviewProjection":1});

const RELOCATED_CLASSES = Object.freeze(['DependencyCycleError', 'SupervisedProcesses']);

/** The 19 relocated declarations; the import-back list carries staying reads plus the re-exports. */
const RELOCATED = Object.freeze([
  'ATTENTION_PUSH_INBOX_KINDS', 'ATTENTION_PUSH_ORCHESTRATOR_ONLY_KINDS', 'COORDINATION_MUTATORS',
  'DEFAULT_DRAIN_POLICY', 'PHYSICAL_LOG_APPENDS', 'SUPERVISED_STREAM_TAIL_BYTES',
  'TRANSIENT_TURN_RETRY_LIMIT', 'bestEffort', 'bestEffortSync', 'cardAcceptsExactModel',
  'coachingError', 'defaultAccept', 'guidanceSender', 'guidanceSenderLabel', 'normalizeDrainPolicy',
  'normalizedDecisionText', 'resolveCardModel', 'DependencyCycleError', 'SupervisedProcesses',
]);
const IMPORTED_BACK = Object.freeze(['coachingError', 'resolveCardModel', 'SupervisedProcesses']);
const REEXPORTED = Object.freeze(['DependencyCycleError', 'SupervisedProcesses', 'guidanceSender']);

/** The reroute census across the bucket, as generated and verified against the source. The
 * constructor records nothing through the port — it composes it — so its boundary is
 * (coordinator, opts) and it is not counted here. Slice 12's admission prefixes add their own:
 * _admitDelivery's two stale_rejected appends and two sealed-Run coordination reads. */
const REROUTE_TOTALS = Object.freeze({ logAppend: 7, mapEvent: 4, coordRecord: 1, coordination: 40 });

test('RA1: the module imports neither monolith and keeps no implicit receiver outside the relocated classes', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  const thisSites = [];
  const walk = (node, owner) => {
    if (node.kind() === 'class_declaration' || node.kind() === 'function_declaration') {
      owner = node.field('name')?.text() ?? owner;
    }
    if (node.kind() === 'this') thisSites.push(owner);
    for (const child of node.children()) walk(child, owner);
  };
  walk(root, '(module scope)');
  const outside = thisSites.filter((owner) => !RELOCATED_CLASSES.includes(owner));
  assert.deepEqual(outside, [], 'moved bodies and helpers never read an implicit receiver');
});

test('RA2: every runtime_admission_port delegate keeps the member name, parameter list, arity, and hands over the recorder', () => {
  const map = JSON.parse(read(MAP_FILE));
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('admission:runtime_admission_port'))
    .map((member) => member.name);
  assert.equal(delegated.length, 93, `expected the 93 moved delegates in the map, found ${delegated.length}`);

  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  const coordRoot = parseOf(read(COORD_FILE));
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  const coordText = read(COORD_FILE);
  for (const name of delegated) {
    const method = byName.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    assert.ok(memberParams.has(name), `${name}: the module must export it`);
    const moduleOwn = memberParams.get(name)
      .replace(/^\(coordinator, recorder,?\s*/u, '(')
      .replace(/^\(coordinator,?\s*/u, '(')
      .replaceAll('coordinator.', 'this.');
    assert.equal(method.field('parameters')?.text() ?? '()', moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (receiver spellings normalized)`);
    const descriptor = Object.getOwnPropertyDescriptor(Coordinator.prototype, name);
    assert.ok(descriptor, `${name}: the class must still answer on ${name}`);
    assert.equal(descriptor.value.length, ARITIES[name], `${name}: the signature must not move with the body`);
    if (name === 'constructor') {
      assert.ok(method.text().includes('runtimeAdmission.constructor(this, opts)'),
        'the constructor delegate hands (this, opts) — it composes the recorder, it does not receive it');
      assert.ok(!method.text().includes('return '), 'a constructor delegate returns nothing');
    } else {
      assert.ok(method.text().includes(`runtimeAdmission.${name}(this, this._recorder`),
        `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    }
  }
});

test('RA3: the recorder is the only recording path, and the constructor delegate is complete', async () => {
  const text = read(MEMBER_FILE);
  const codeOnly = parseOf(text)
    .findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })
    .map((fn) => fn.text()).join('\n');
  const totals = {
    logAppend: codeOnly.split('recorder.log.append(').length - 1,
    mapEvent: codeOnly.split('recorder.mapEvent(').length - 1,
    coordRecord: codeOnly.split('recorder.recordDriver(').length - 1,
    coordination: codeOnly.split('recorder.coordination').length - 1,
  };
  assert.deepEqual(totals, REROUTE_TOTALS,
    'the bucket records through the port exactly as many times as the pre-move bodies recorded through the class');
  assert.equal(codeOnly.includes('this._log.append('), false);
  assert.equal(codeOnly.includes('this._coordination?.'), false,
    'no moved body reads the store beside the port (assignments by the constructor excepted)');

  // The constructor delegate is complete: a blank prototype constructs identically to new.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const optsOf = (dir) => {
    const log = new Log(join(dir, 'log'));
    return {
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: {},
      worktrees: null,
      capabilities: null,
      referee: async () => ({}),
      route: () => 'mock',
      now: () => 0,
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    };
  };
  const dirA = mkdtempSync(join(tmpdir(), 'baton-ra3-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'baton-ra3-b-'));
  try {
    const viaNew = new Coordinator(optsOf(dirA));
    const blank = Object.create(Coordinator.prototype);
    runtimeAdmission.constructor(blank, optsOf(dirB));
    assert.equal(typeof blank.spawn, 'function', 'the blank construct carries the prototype');
    assert.equal(blank._recorder !== null && typeof blank._recorder.log?.append, 'function',
      'the module-composed constructor builds the recorder port');
    assert.equal(blank._recorder.log, blank._log, 'the port fronts the log facade');
    assert.equal(blank._recorder.coordination, blank._coordination,
      'the port fronts the (proxied) coordination authority');
    assert.deepEqual(blank.list(), viaNew.list(), 'the constructed worker list is identical');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('RA4: the relocated declarations moved once; the export surface is unchanged', () => {
  const coordText = read(COORD_FILE);
  for (const name of RELOCATED) {
    assert.ok(Object.hasOwn(runtimeAdmission, name), `${name}: the module exports it`);
  }
  const importBack = coordText.match(/import \{[^}]*\} from '\.\/runtime-admission\.mjs';/gsu) ?? [];
  const names = importBack.flatMap((statement) => [...statement.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/gu)]
    .map((m) => m[1])
    .filter((n) => !['import', 'from', 'runtime', 'admission', 'mjs'].includes(n)));
  for (const name of IMPORTED_BACK) {
    assert.ok(names.includes(name), `${name}: imported back (staying reads or the re-export)`);
  }
  assert.ok(coordText.includes("export { DependencyCycleError, SupervisedProcesses, guidanceSender } from './runtime-admission.mjs';"),
    'the coordinator re-exports the relocated export surface');
  for (const name of REEXPORTED) {
    assert.equal(coordinatorModule[name], runtimeAdmission[name],
      `${name}: coordinator.mjs resolves to the module's binding`);
  }
  // index.mjs never re-exported these three — the surface contract is coordinator.mjs's own.
});

test('RA5: the map sees the move', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-admission target');
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegates = coordinatorFile.members.filter((member) => member.evidence.includes('admission:runtime_admission_port'));
  for (const member of delegates) {
    assert.equal(member.seam, 'admission', `${member.name}: the delegate keeps the admission seam`);
  }
});

test('RA6: slice 12 — the three tranche-2 admission prefixes are admission-seamed module members that never import effects', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/runtime-effects\.mjs/u.test(source),
      `admission never imports effects — that direction is the cycle (slice-12 design §6): ${source}`);
  }
  const fns = new Map(root.findAll({ rule: { kind: 'function_declaration' } })
    .map((fn) => [fn.field('name')?.text(), fn]));
  const EXPECTED = {
    _admitRunStopTargets: '(coordinator, recorder, targetWorkerIds, actor, opts)',
    _admitIntegration: '(coordinator, handle, task, opts)',
    _admitDelivery: '(coordinator, recorder, handle, mode, opts)',
  };
  for (const [name, params] of Object.entries(EXPECTED)) {
    const fn = fns.get(name);
    assert.ok(fn, `${name}: the admission prefix lives in this module`);
    assert.equal(fn.field('parameters').text(), params, `${name}: the design's own signature`);
  }
  // All three prefixes are sync refusal chains. The run-stop startup-reconciliation WAIT stays
  // in the effect body at its verbatim position: an async admission prefix would adopt one
  // settlement hop (the slice-11 lesson), and phase91's P91-12 pins the exact hop count — a stop
  // must win against a preserved-successor delivery racing it.
  for (const name of Object.keys(EXPECTED)) {
    assert.ok(!fns.get(name).text().startsWith('async function'),
      `${name}: sync — no adopted-promise hop between admission and the act`);
  }
  // The prefixes classify admission on their own evidence.
  const map = JSON.parse(read(MAP_FILE));
  const byName = new Map(map.files.find((file) => file.file === MEMBER_FILE)
    .members.map((member) => [member.name, member]));
  for (const name of Object.keys(EXPECTED)) {
    assert.equal(byName.get(name)?.seam, 'admission', `${name}: the prefix keeps the admission seam`);
  }
  // The refusal throws keep their pre-move codes (the admission half of the no-behavior-change
  // law); the startup-reconciliation throw rides with the wait in the effect body.
  assert.ok(fns.get('_admitRunStopTargets').text().includes("'coordinator_run_stop_invalid'")
    && fns.get('_admitRunStopTargets').text().includes("'coordinator_closed'"),
  '_admitRunStopTargets throws the exact pre-move codes');
  for (const code of ['result_not_accepted', 'scratch_oracle_not_integrable', 'independent_oracle_required',
    'unsupported_strategy', 'integration_unavailable', 'worker_not_quiescent']) {
    assert.ok(fns.get('_admitIntegration').text().includes(`'${code}'`),
      `_admitIntegration throws ${code}`);
  }
});
