// coordination-admission.test.mjs — issue #259, slice 5. Pins the module the store's admission bucket
// moved into (impl/src/coordination-admission.mjs) and the store that now delegates to it. The claims
// are slice 4's, restated for this bucket:
//
//   1. CONTEXT-FREE — the module has no `this`, no module-level mutable state, and never imports the
//      store back: every helper is a function of what it is handed, nothing else.
//   2. THE PORT IS EXPLICIT — every moved member keeps a same-name, same-arity delegate on
//      `CoordinationStore`, and the committed seam map, the delegates, the module's exports and the
//      store's imports agree, one delegate per helper.
//   3. THE SAME INPUT GIVES THE SAME OUTPUT — calling every exported helper against two independently
//      built, identically seeded stores produces identical values (or identical refusals), and the
//      helpers handed one collection do not write it.
//   4. THE STORE'S DECISIONS ARE UNCHANGED — a real fixture (create, claim, the five admission
//      refusals, idempotent retry, restart) refuses with the same typed codes and writes the same
//      ledger bytes the pre-move store wrote.
//   5. THE DISPATCH IS UNCHANGED — a moved member is still reached THROUGH the class, so a store
//      whose admission member is patched in place still sees the patch (a moved body calls its
//      siblings as `store.<member>(`, never as a bare module-local function).
//
// `CA6` pins the half of this slice that is not the move: the fourth and fifth source scans that read
// a member's own text (the acceptance-revocation ceilings, the admit gate, the target-set helper, and
// F1's file-keyed byte exemptions) now resolve through `test/seam-member-source.mjs` and the
// `STORE_MODULE_FILES` list it exports.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as coordinationAdmission from '../src/coordination-admission.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { STORE_MODULE_FILES, memberSource, memberSpans } from './seam-member-source.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MODULE = Object.freeze({
  file: 'src/coordination-admission.mjs',
  artifact: 'impl/src/coordination-admission.mjs',
  namespace: 'coordinationAdmission',
  exports: coordinationAdmission,
});
const STORE_FILE = 'src/coordination-store.mjs';
const MAP_STORE_FILE = 'impl/src/coordination-store.mjs';
const MAP_MODULE_FILE = 'impl/src/coordination-admission.mjs';
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();
const tokens = (node) => node.children().filter((child) => !['(', ')', ','].includes(child.kind()));

/** `Function.length`'s rule: parameters before the first default or rest parameter. A destructuring
 * parameter is one parameter, so a member's declared shape and its delegate's are compared on the
 * same measure — the one an external caller sees. */
function lengthOf(parameters) {
  let count = 0;
  for (const parameter of parameters) {
    if (parameter.kind() === 'assignment_pattern' || parameter.kind() === 'rest_pattern') break;
    count += 1;
  }
  return count;
}

/** The identifiers a node reads as variables — property names and object keys are not reads. */
function freeIdentifiers(node) {
  const names = new Set();
  for (const identifier of node.findAll({ rule: { kind: 'identifier' } })) {
    const parent = identifier.parent();
    if (parent && parent.kind() === 'member_expression' && parent.field('property')?.id() === identifier.id()) continue;
    if (parent && (parent.kind() === 'pair' || parent.kind() === 'pair_pattern') && parent.field('key')?.id() === identifier.id()) continue;
    names.add(identifier.text());
  }
  return names;
}

/** The fixture claims 3 and 4 run on: create, claim, the admission refusals, an idempotent retry. */
function fixture(clock = () => '2026-09-19T00:00:00.000Z') {
  const root = mkdtempSync(join(tmpdir(), 'baton-coordination-admission-'));
  const store = new CoordinationStore(root, { clock, repoId: 'repo-admission' });
  const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
  const records = [
    store.createTask(fields('ca-a'), { actor: 'orchestrator', key: 'fixture-a' }),
    store.createTask(fields('ca-b', ['ca-a']), { actor: 'orchestrator', key: 'fixture-b' }),
    store.claimTask('ca-a', 'w-ca-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' }),
  ];
  return { root, store, records, fields, clock, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The delegate every moved member kept: `return coordinationAdmission.<helper>(<state>, …)`. */
function delegates() {
  const declaration = parseOf(read(STORE_FILE)).findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'CoordinationStore');
  const wired = new Map();
  for (const member of declaration.field('body').children()) {
    if (member.kind() !== 'method_definition') continue;
    const body = member.field('body');
    const statements = body.children();
    if (statements.length !== 3 || statements[1].kind() !== 'return_statement') continue;
    const call = statements[1].children().find((child) => child.kind() === 'call_expression' || child.kind() === 'yield_expression');
    const invoked = call?.kind() === 'yield_expression' ? call.children().find((child) => child.kind() === 'call_expression') : call;
    const callee = invoked?.field('function');
    if (!callee || callee.kind() !== 'member_expression' || callee.field('object')?.text() !== MODULE.namespace) continue;
    const args = tokens(invoked.field('arguments'));
    wired.set(member.field('name')?.text(), {
      helper: callee.field('property')?.text(),
      state: args[0]?.text() === 'this' ? 'store' : args[0]?.text()?.replace(/^this\./u, ''),
      arity: lengthOf(tokens(member.field('parameters'))),
    });
  }
  return wired;
}

/** Every name the store imports from the moved module, so a dangling import cannot hide. */
function importedFromMovedModule() {
  const found = [];
  for (const statement of parseOf(read(STORE_FILE)).children()) {
    if (statement.kind() !== 'import_statement') continue;
    const source = statement.children().find((child) => child.kind() === 'string')?.text()?.slice(1, -1);
    if (source !== './coordination-admission.mjs') continue;
    for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) found.push(specifier.field('name')?.text());
  }
  return found;
}

/** Every exported function of the moved module, with its declared parameters. */
function exportedFunctions(text) {
  const found = [];
  for (const statement of parseOf(text).children()) {
    const declaration = statement.field('declaration');
    if (statement.kind() !== 'export_statement' || !['function_declaration', 'generator_function_declaration'].includes(declaration?.kind())) continue;
    found.push({ name: declaration.field('name')?.text(), parameters: tokens(declaration.field('parameters')), declaration });
  }
  return found;
}

/** A value or a refusal, reduced to something two runs can be compared on. */
function outcome(fn, args, root) {
  try {
    const value = JSON.stringify(fn(...args) ?? null) ?? 'undefined';
    return `value:${value.split(root).join('<root>')}`;
  } catch (error) {
    return `refusal:${error?.code ?? error?.name}:${error?.message}`;
  }
}

/** The typed code a store call refuses with, or `null` when it does not refuse. */
function refusalCode(fn) {
  try { fn(); return null; } catch (error) { return error?.code ?? error?.name ?? 'error'; }
}

const snapshotOf = (value) => JSON.stringify(value instanceof Map ? [...value] : value);

test('CA1: the moved module is context-free — no this, no mutable module state, no store import', () => {
  const root = parseOf(read(MODULE.file));
  const classes = new Set(root.findAll({ rule: { kind: 'class_declaration' } }).map((node) => node.id()));
  const receivers = root.findAll({ rule: { kind: 'this' } })
    .filter((node) => { let parent = node.parent(); while (parent) { if (classes.has(parent.id())) return false; parent = parent.parent(); } return true; })
    .map((node) => node.range().start.line);
  assert.deepEqual(receivers, [], `${MODULE.file}: a moved helper must not read an implicit receiver`);
  const mutable = [];
  const bound = new Set();
  for (const statement of root.children()) {
    const kind = statement.kind();
    if (kind === 'variable_declaration') mutable.push(statement.text().slice(0, 60));
    if (kind === 'lexical_declaration' && statement.children().some((child) => child.kind() === 'let')) mutable.push(statement.text().slice(0, 60));
    if (kind === 'import_statement') {
      const source = statement.children().find((child) => child.kind() === 'string')?.text();
      assert.notEqual(source, "'./coordination-store.mjs'",
        `${MODULE.file}: the store imports this module, so this import would close a cycle`);
      for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
        bound.add(specifier.field('alias')?.text() ?? specifier.field('name')?.text());
      }
      continue;
    }
    const declaration = kind === 'export_statement' ? (statement.field('declaration') ?? statement) : statement;
    for (const declarator of declaration.children()) {
      if (declarator.kind() === 'variable_declarator') bound.add(declarator.field('name')?.text());
    }
    const declared = declaration.field('name')?.text();
    if (declared) bound.add(declared);
  }
  const written = [];
  for (const statement of root.children()) {
    for (const assignment of statement.findAll({ rule: { kind: 'assignment_expression' } })) {
      const target = assignment.field('left');
      if (target?.kind() === 'identifier' && bound.has(target.text())) written.push(assignment.text().slice(0, 60));
    }
  }
  assert.deepEqual([...mutable, ...written], [], `${MODULE.file}: module-level state is constant only, never written`);
});

test('CA2: the committed map, the delegates, the exports and the store imports are one bijection', () => {
  const map = JSON.parse(read('scripts/seam-inventory.json'));
  const moved = new Map();
  for (const member of map.files.find((file) => file.file === MAP_STORE_FILE).members) {
    if (member.evidence.some((entry) => entry.endsWith(':admission_port'))) moved.set(`${member.name}\u0000${member.ordinal}`, member.name);
  }
  assert.equal(moved.size, 173, 'the map must show the admission bucket — every store member whose body left');
  const movedNames = new Set(moved.values());
  const wired = delegates();
  const orphans = [...moved.keys()].filter((identity) => !wired.has(identity.split('\u0000')[0]));
  assert.deepEqual(orphans, [], 'every mapped move must still be a delegate on the class');
  for (const [member, delegate] of wired) {
    assert.ok(movedNames.has(member), `${member}: the delegate must carry the admission_port evidence`);
    assert.ok(Object.hasOwn(MODULE.exports, delegate.helper), `${member}: ${MODULE.namespace}.${delegate.helper} must be exported`);
  }
  const helpers = [...wired.values()].map((delegate) => delegate.helper);
  assert.equal(new Set(helpers).size, helpers.length, 'one delegate per admission helper');
  assert.equal(helpers.length, 173, 'the port carries one helper per moved member');
  const moduleRows = map.files.find((file) => file.file === MAP_MODULE_FILE).members;
  for (const name of new Set(helpers)) {
    assert.equal(moduleRows.filter((member) => member.name === name).length, 1,
      `${name}: the seam map carries the body once, by name, in ${MAP_MODULE_FILE}`);
  }
  for (const imported of importedFromMovedModule()) {
    assert.ok(Object.hasOwn(MODULE.exports, imported), `${STORE_FILE}: imports ${imported}, which the module must export`);
  }
});

test('CA3: the same input gives the same output, and a handed slice is never written', () => {
  const wired = delegates();
  const failures = [];
  const declared = new Map(exportedFunctions(read(MODULE.file)).map((entry) => [entry.name, entry]));
  for (const [member, delegate] of wired) {
    const entry = declared.get(delegate.helper);
    assert.ok(entry, `${member}: ${delegate.helper} must be an exported function`);
    const { name, parameters, declaration } = entry;
    const reads = freeIdentifiers(declaration);
    const firstParameter = parameters[0]?.kind() === 'identifier' ? parameters[0].text() : null;
    const declaresStore = firstParameter === 'store';
    const declaresSlice = firstParameter !== null && firstParameter !== 'store'
      && (firstParameter === 'state' || firstParameter === delegate.state);
    assert.ok(!declaresSlice || reads.has(firstParameter),
      `${MODULE.file}: ${name} (from ${member}) must read the ${firstParameter} slice it declares`);
    assert.ok(!(declaresSlice && reads.has('store')),
      `${MODULE.file}: ${name} (from ${member}) takes one slice and must not reach for the store as well`);
    const stateParameter = declaresStore ? 'store' : (declaresSlice ? 'state' : null);
    const sliceField = declaresSlice ? delegate.state : null;
    const first = fixture();
    const second = fixture();
    try {
      const argsOf = (built) => {
        if (stateParameter === null) return [];
        const state = stateParameter === 'store' ? built.store : built.store[sliceField];
        return [state, ...parameters.slice(1).map(() => undefined)];
      };
      const before = sliceField === null ? null : snapshotOf(first.store[sliceField]);
      const fromFirst = outcome(MODULE.exports[name], argsOf(first), first.root);
      const fromSecond = outcome(MODULE.exports[name], argsOf(second), second.root);
      if (fromFirst !== fromSecond) failures.push(`${MODULE.file}: ${name} — ${fromFirst} vs ${fromSecond}`);
      if (before !== null && snapshotOf(first.store[sliceField]) !== before) {
        failures.push(`${MODULE.file}: ${name} wrote the ${sliceField} slice it was handed`);
      }
    } finally {
      first.cleanup();
      second.cleanup();
    }
  }
  const moved = new Set([...wired.values()].map((delegate) => delegate.helper));
  for (const [name, entry] of declared) {
    if (moved.has(name) || typeof MODULE.exports[name] !== 'function' || /^[A-Z]/u.test(name)) continue;
    const once = outcome(MODULE.exports[name], entry.parameters.map(() => undefined), '/');
    const twice = outcome(MODULE.exports[name], entry.parameters.map(() => undefined), '/');
    if (once !== twice) failures.push(`${MODULE.file}: ${name} — ${once} vs ${twice}`);
  }
  assert.deepEqual(failures, [], 'a moved helper must be a function of the state it is handed');
});

test('CA4: the store reaches every moved member through its own delegate, with its own arity', () => {
  const MOVED = [
  ['_validateCanonicalReceipt', 3], ['_configureAdvisoryFeedCards', 1], ['_assertWriterLease', 0],
  ['_assertLeaseOwnership', 0], ['_validateRecordedPayload', 2], ['_taskTopologyFailure', 3],
  ['_validateTaskTopology', 1], ['previewTaskTopology', 1], ['_runLineageFailure', 2],
  ['_normalizeRunOrchestratorLeaseRequest', 1], ['_deriveRunOrchestratorLeasePayload', 2],
  ['_validateRunOrchestratorLeaseIssued', 2], ['_isRunOrchestratorLeaseRevokeKey', 2],
  ['_validateRunOrchestratorLeaseRevoked', 2], ['_deriveRunLineagePayload', 2],
  ['_validateRunLineageAdmission', 2], ['admitRunLineage', 2], ['authorizeRunOrchestratorCommand', 2],
  ['_goalPlanFailure', 2], ['_representationFailure', 1], ['_representationRequest', 2],
  ['_representationSource', 4], ['_representationGraphTemplate', 2],
  ['_validateRepresentationNamespaces', 1], ['_validateRepresentationPayload', 2],
  ['_validateRunSealPayload', 2], ['_validateRouteObservationPayload', 2],
  ['_validateReuseDecisionPayload', 2], ['_validateReusePolicyPayload', 2],
  ['_guardFromRiskPayload', 2], ['_validateReuseRiskPayload', 2], ['_validateReuseTtlPayload', 2],
  ['_validateProviderDeliveryPayload', 2], ['_validateProviderReconciliationPayload', 2],
  ['_validateProviderDeferralPayload', 2], ['_validateProviderGreenPayload', 2],
  ['_validateProviderAdversePayload', 2], ['_validateFleetDrainAdmission', 2],
  ['_validateFleetDrainCompletion', 2], ['_validateFleetDrainDisposition', 2],
  ['_validateRunControlAdmission', 2], ['_validateRunControlEffect', 2],
  ['_validateRunControlProviderAck', 2], ['_validateRunControlSettlement', 2],
  ['_validateRunStopAdmission', 2], ['_validateRunStopCompletion', 2],
  ['_runResultAdoptionFailure', 1], ['_normalizeRunResultAdoptionRequest', 2],
  ['_deriveRunResultAdoptionBinding', 1], ['_validateRunResultAdoptionAdmission', 2],
  ['_validateRunResultAdoptionCompletion', 2], ['_runResultExportFailure', 1],
  ['_normalizeRunResultExportRequest', 2], ['_deriveRunResultExportBinding', 1],
  ['_validateRunResultExportAdmission', 2], ['_validateRunResultExportCompletion', 2],
  ['_contextFailure', 2], ['_contextDefinition', 1], ['_normalizeContextDeployment', 1],
  ['_normalizeContextSourceAttestation', 2], ['_assertContextSessionCurrent', 1],
  ['_validateContextSessionPayload', 2], ['_validateContextCellAdmissionPayload', 2],
  ['_validateContextCellSettlementPayload', 2], ['_validateContextMapCallAdmissionPayload', 2],
  ['_validateContextEffectCallAdmissionPayload', 2], ['_validateTaskResourceReleasePayload', 2],
  ['_normalizeContextCleanupReceipt', 4], ['_normalizeContextMapCleanupReceipt', 3],
  ['_normalizeContextEffectCleanupReceipt', 3], ['_validateContextProviderResults', 5],
  ['_validateContextMapProviderResults', 4], ['_validateContextEffectProviderResults', 4],
  ['_validateContextMapPlanProposal', 1], ['_validateContextCallPlanProposal', 1],
  ['_validateContextMapResultLineageEvidence', 5], ['_validateContextEffectResultLineageEvidence', 5],
  ['_validateContextMapCallSettlementPayload', 2], ['_validateContextEffectCallSettlementPayload', 2],
  ['_assertRunAdmissionOpen', 1], ['_acceptanceRevocationFailure', 2],
  ['_validateAcceptanceRevocationPayload', 2], ['_planBudgetFailure', 2],
  ['_derivePlanBudgetSettlement', 1], ['_validatePlanBudgetSettlement', 2],
  ['_contextRetrySelection', 1], ['contextRetryEligibility', 1], ['contextCallSettlementChildren', 1],
  ['_contextCallArtifacts', 2], ['_validateContextCompletionArtifacts', 4],
  ['contextCellArtifacts', 1], ['_normalizeContextPackageSourceRef', 2],
  ['_normalizeContextPackageArtifactRef', 2], ['_normalizeContextPackageValueRef', 2],
  ['_normalizeContextPackageSchemaRef', 2], ['_normalizeContextPackageBranch', 2],
  ['_normalizeContextPackage', 1], ['_resolveContextPackageBranchContent', 2],
  ['resolveContextPackageBranch', 2], ['admitPackageCommand', 1], ['admitContextPackage', 2],
  ['admitContextSession', 2], ['replManifestAdmission', 1], ['_replManifestFailure', 2],
  ['_validateReplManifestAdmissionPayload', 2], ['admitReplManifest', 2], ['admitReplSession', 2],
  ['admitContextCell', 2], ['admitContextMapCall', 2], ['admitContextEffectCall', 2],
  ['previewPlanDispatch', 2], ['previewPlanRevision', 2], ['representationProductionAdmission', 2],
  ['prepareRepresentationProduction', 2], ['_effectiveRunOrchestratorLeaseState', 1],
  ['admitRunResultAdoption', 2], ['_runVerificationRetryFailure', 1],
  ['_normalizeRunVerificationRetryRequest', 2], ['_validateRunVerificationRetryAdmission', 2],
  ['_validateRunVerificationRetryCompletion', 2], ['admitRunVerificationRetry', 2],
  ['admitRunResultExport', 2], ['admitRunControl', 2], ['admitRunStop', 2], ['admitFleetDrain', 2],
  ['admitWebCommand', 2], ['admitMcpCall', 2], ['_isDerivedPlanSemanticReview', 1],
  ['_validateProvisionalResultRef', 1], ['_prepareArtifact', 2], ['providerProcessingAdmission', 2],
  ['reuseDecisionAdmission', 2], ['reuseRiskAdmission', 2], ['reuseTtlAdmission', 2],
  ['_validateWaveClosedPayload', 1], ['_resolvedSpill', 1], ['hasSwarmParticipantRun', 1],
  ['_assertOrientationReceiptCeiling', 1], ['_assertOrientationProposalCeiling', 1],
  ['checkScratch', 2], ['_boardAdmissionFailure', 2], ['admitBoardCommand', 1],
  ['admitWorkerBoardCommand', 1], ['_resolveReplManifestBranch', 1], ['admitReplBinding', 2],
  ['resolveReplCitation', 2], ['_knowledgeFailure', 2], ['_validateKnowledgeContent', 1],
  ['_validateKnowledgeEvidence', 0], ['_validateKnowledgeTimes', 1],
  ['_validateKnowledgeNodePayload', 2], ['_validateKnowledgeEdgePayload', 2],
  ['_deriveKnowledgePromotion', 3], ['_validateKnowledgePromotionPayload', 2],
  ['reverifyKnowledgePromotion', 5], ['reverifyKnowledgePromotionNoOp', 3],
  ['_eligibleScratchOracle', 5], ['_deriveScratchCorrection', 4],
  ['_validateScratchCorrectionPayload', 2], ['reverifyScratchCorrection', 6],
  ['_deriveWorkflowAdmission', 4], ['_validateWorkflowAdmissionPayload', 2],
  ['admitWorkflowFinding', 6], ['_prepareKnowledgeNode', 1],
  ['_deriveBoundedContradictionResolution', 4], ['_validateBoundedContradictionResolutionPayload', 2],
  ['reverifyKnowledgeContradictionResolution', 6], ['_validateContradictionResolution', 1],
  ['_validateKnowledgeInvalidation', 2], ['_validateContaminationRecord', 2],
  ['_validateKnowledgeRecallPayload', 2], ['_validateKnowledgeRecallAssessmentPayload', 2],
  ['admitReplFanout', 2],
  ];
  assert.equal(MOVED.length, 173, 'the admission bucket is 173 members');
  const wired = delegates();
  for (const [name, arity] of MOVED) {
    assert.ok(wired.has(name), `${name}: the class must still delegate it`);
    assert.equal(wired.get(name).arity, arity, `${name}: the delegate forwards the same parameters`);
    assert.equal(wired.get(name).helper, name, `${name}: the delegate names the member's own body`);
    const descriptor = Object.getOwnPropertyDescriptor(CoordinationStore.prototype, name)
      ?? Object.getOwnPropertyDescriptor(CoordinationStore, name);
    assert.ok(descriptor, `${name}: the store must still answer on ${name}`);
    assert.equal(descriptor.value?.length ?? descriptor.get?.length, arity, `${name}: the signature must not move with the body`);
  }
  assert.equal(wired.size, 173, 'the admission port carries exactly the admission bucket');
});

test('CA5: the store keeps its exact decisions across the move, and a moved member is still dispatched through the class', () => {
  const { root, store, records, fields, clock, cleanup } = fixture();
  try {
    assert.deepEqual(records.map((record) => record.event.seq), [1, 2, 3]);
    // Every refusal below is raised by a member that moved: the task admission, the dependency
    // admission, the claim admission and the run-stop admission.
    assert.equal(refusalCode(() => store.claimTask('ca-a', 'w-ca-a', 2, { actor: 'orchestrator', key: 'fixture-claim-a2' })), 'already_assigned');
    assert.equal(refusalCode(() => store.createTask(fields('ca-a'), { actor: 'orchestrator', key: 'fixture-dup' })), 'duplicate_task');
    assert.equal(refusalCode(() => store.createTask({ ...fields('ca-y'), deps: ['ca-missing'] }, { actor: 'orchestrator', key: 'fixture-y' })), 'missing_dependency');
    assert.equal(refusalCode(() => store.claimTask('ca-b', 'w-ca-b', 1, { actor: 'orchestrator', key: 'fixture-claim-b' })), 'deps_unsatisfied');
    assert.equal(refusalCode(() => store.admitRunStop(
      { schemaVersion: 1, repoId: 'repo-admission', runId: 'run-x', reasonDigest: 'a'.repeat(64), requestDigest: 'b'.repeat(64) },
      { actor: 'orchestrator', key: 'fixture-stop' },
    )), 'run_stop_invalid');
    const retry = store.createTask(fields('ca-b', ['ca-a']), { actor: 'orchestrator', key: 'fixture-b' });
    assert.deepEqual([retry.result, retry.event.seq, retry.event.kind], ['idempotent', 2, 'task.created']);
    assert.deepEqual(store.task('ca-a'), {
      id: 'ca-a', brief: { goal: 'ca-a' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-ca-a',
      runId: null, status: 'working', assignee: 'w-ca-a', version: 2, createdEvent: 1, claimedEvent: 3,
      terminalEvent: null, artifactIds: [],
    });
    const ledger = readFileSync(join(root, 'events.jsonl'));
    assert.equal(createHash('sha256').update(ledger).digest('hex'),
      '9bbb02a1dcbea7f50474a8a54d7162b01236f761c7be17e219becb0d93d1b962',
      'the durable bytes are the ones the pre-move store wrote for the same fixture');
    const before = createHash('sha256').update(JSON.stringify(store.snapshot())).digest('hex');
    assert.equal(before, '84cc51b61594ef9dec990893f9b51c4e83c21196895a26a7a19ca2989d4538f7',
      'the projection the moved admission builds is the one the pre-move store built');
    const restarted = new CoordinationStore(root, { clock });
    assert.equal(restarted.healthCheck(), true);
    assert.equal(createHash('sha256').update(JSON.stringify(restarted.snapshot())).digest('hex'), before,
      'replay reconstructs the identical projection');
  } finally {
    cleanup();
  }

  // The moved member is reached THROUGH the class: a store whose `_validateTaskTopology` is patched
  // in place still sees the patch. A module-local call would bypass it.
  const other = fixture(clock);
  try {
    let patched = 0;
    const validate = other.store._validateTaskTopology.bind(other.store);
    other.store._validateTaskTopology = (state, payload, hint, integrity) => { patched += 1; return validate(state, payload, hint, integrity); };
    const record = other.store.createTask(other.fields('ca-c'), { actor: 'orchestrator', key: 'fixture-c' });
    assert.equal(record.result, 'created');
    assert.ok(patched > 0, 'the admission path still dispatches `_validateTaskTopology` through the store');
  } finally {
    other.cleanup();
  }
});

test('CA6: the pins that read a moved member\'s text resolve it through the live seam map', () => {
  const gate = memberSource('admitWorkflowFinding');
  assert.ok(gate.includes('workflow_admit_lease_invalid'), 'the admit gate reads by member name');
  const helper = memberSource('assertTargetSetAdmissible');
  assert.ok(helper.includes("FRAME_LIMITS['target_set.per_ledger_event']"),
    'a module-scope helper of the store\'s module scope reads by name too');
  const gateFiles = memberSpans('admitWorkflowFinding').map((span) => span.file);
  assert.ok(gateFiles.includes('coordination-admission.mjs') && gateFiles.includes('coordination-store.mjs'),
    'the gate is a delegate on the class and a body in the module');

  // The file list the scans that read the store's module scope share, stated once. Slice 7 adds
  // the effect bucket's file (the writer-lease helpers' literals ride it — F1's exec-buffer
  // exemption follows them there).
  assert.deepEqual([...STORE_MODULE_FILES], ['coordination-store.mjs', 'coordination-ledger.mjs', 'coordination-admission.mjs', 'coordination-ledger-writes.mjs']);
  assert.equal(read(STORE_FILE).includes('workflow_admit_lease_invalid'), false,
    'the gate body left the store file: a file-keyed scan would now miss it');
  for (const file of ['test/kg-activation-red.test.mjs', 'test/issue286-ceilings.test.mjs', 'test/issue366-run-stop-replay-ceiling.test.mjs']) {
    assert.ok(read(file).includes('STORE_MODULE_FILES'), `${file}: the scan names the store's module scope`);
  }
});
