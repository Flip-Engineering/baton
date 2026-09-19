// application-admission.test.mjs — issue #259, slice 16. Pins the module the application's
// admission bucket moved into (impl/src/application-admission.mjs — 36 members: the
// authority-op guards, the route and policy admission, and the argument normalizers) against the
// bare 'application' receiver, and the BatonApplication class that now delegates to it. Five
// claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither application.mjs nor
//      coordinator.mjs and contains no 'this' at all; it reads the slice-15 observation helpers
//      through their own module, never through the host.
//   2. SAME NAME, SAME ARITY, SAME RECEIVER — every delegate the seam map shows as
//      admission:application_admission_port keeps the member's own parameter list and arity on
//      both sides of the boundary; the module function's parameter list is the member's own with
//      'application' prepended; the 7 async members keep async.
//   3. THE READS ARE THE RECORDING — the bucket appends nothing, and the durable-read census
//      (15 driver-coordination reads) is pinned against the pre-move source.
//   4. THE HELPERS MOVED ONCE — the 16 relocated module-scope declarations
//      (12 functions, 4 consts) are declared exactly once, module-side; the host
//      imports back the 8 its staying code reads; 20 slice-15 exports and
//      4 original-module bindings cover the rest of the closure.
//   5. THE MAP SEES THE MOVE — the committed artifact carries the application-admission target
//      with 48 members, application.mjs stays at 237, and every moved delegate keeps
//      admission through the application_admission_port rule.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as applicationAdmission from '../src/application-admission.mjs';
import { BatonApplication } from '../src/application.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/application-admission.mjs';
const HOST_FILE = 'impl/src/application.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const ARITIES = Object.freeze({"_resolveSemanticControlTarget":3,"_normalizeRunControlOutcome":1,"_resolveIntent":1,"_admitWorkspaceAttachment":2,"_resolveSpillObjective":1,"_isWorkflowRun":1,"resolveCompletedResultExport":1,"_validateSemanticEvidence":2,"_parseSemanticReview":3,"_semanticReview":2,"_assertRunMutable":1,"_admitRecursiveRun":3,"_assertRouteAdmission":1,"_runViewOversizeRefusal":4,"_workflowRevisionEligibility":1,"_validateWorkflowRevisionPlan":1,"_validateContextMapPlan":1,"_validateContextEffectPlan":1,"_resolveContextEvalRunTarget":2,"_resolveContextEvalManifestTarget":1,"admitContextPackage":2,"_selectedSemanticItem":5,"_resolveWorkflowSpec":2,"_normalizeWaveStart":1,"_normalizeWaveProgress":1,"_normalizeWaveList":1,"_normalizeWaveMemberAction":2,"_normalizeMessageSend":1,"_normalizeMessageReceipt":1,"_normalizeAttentionWatch":1,"_normalizeScratchpadRead":1,"_normalizeScratchpadAppend":1,"_normalizeScratchpadElevate":1,"_normalizeBoardPost":1,"_normalizeBoardRead":1,"_normalizeKnowledgeSeed":1});

const PARAMS = Object.freeze({"_resolveSemanticControlTarget":"(current, recipient, operation)","_normalizeRunControlOutcome":"(outcome, schemaVersion = 2)","_resolveIntent":"(rawIntent)","_admitWorkspaceAttachment":"(runId, workspace)","_resolveSpillObjective":"(objective)","_isWorkflowRun":"(current)","resolveCompletedResultExport":"(coordinates)","_validateSemanticEvidence":"(ref, target)","_parseSemanticReview":"(inspection, current, target)","_semanticReview":"(current, baseView)","_assertRunMutable":"(runId)","_admitRecursiveRun":"(intent, principal, context)","_assertRouteAdmission":"(intent)","_runViewOversizeRefusal":"(runId, view, observed, shed)","_workflowRevisionEligibility":"(current, prepared = {})","_validateWorkflowRevisionPlan":"(current)","_validateContextMapPlan":"(current)","_validateContextEffectPlan":"(current)","_resolveContextEvalRunTarget":"(runId, role)","_resolveContextEvalManifestTarget":"(manifestDigest)","admitContextPackage":"(rawFields, rawPrincipal, rawContext = null)","_selectedSemanticItem":"(current, view, section, item, items, episodeContext = null)","_resolveWorkflowSpec":"(request, repoRoot)","_normalizeWaveStart":"(value)","_normalizeWaveProgress":"(value)","_normalizeWaveList":"(value)","_normalizeWaveMemberAction":"(value, label, opts = {})","_normalizeMessageSend":"(value)","_normalizeMessageReceipt":"(value)","_normalizeAttentionWatch":"(value)","_normalizeScratchpadRead":"(value)","_normalizeScratchpadAppend":"(value)","_normalizeScratchpadElevate":"(value)","_normalizeBoardPost":"(value)","_normalizeBoardRead":"(value)","_normalizeKnowledgeSeed":"(value)"});

const ASYNC = Object.freeze(["_semanticReview","_workflowRevisionEligibility","_validateWorkflowRevisionPlan","_resolveContextEvalRunTarget","_resolveContextEvalManifestTarget","admitContextPackage","_resolveWorkflowSpec"]);

/** The relocated module-scope declarations, sorted. */
const RELOCATED = Object.freeze(["DRIVER_KINDS","MAX_REVIEW_SOURCE_BYTES","RESULT_INTENTS","ROUTE_TEACHING_GRAMMAR","compareRouteTeachingRow","contentDigest","explicitResultIntentIdentity","formatRequestedRoute","normalizeIntent","normalizeRouteSelector","normalizeWorkflowComposition","projectRouteTeachingRow","routeEqual","routeNotAllowedRefusal","semanticSourceSlice","workflowFeedbackBodySetDigest"]);

/** The host's import-back list. */
const IMPORT_BACK = Object.freeze(["MAX_REVIEW_SOURCE_BYTES","contentDigest","explicitResultIntentIdentity","normalizeIntent","routeEqual","routeNotAllowedRefusal","semanticSourceSlice","workflowFeedbackBodySetDigest"]);

/** The slice-15 exports the admission bodies share, and the re-sourced original-module bindings. */
const OBSERVATION_IMPORTS = Object.freeze(["APPLICATION_WORKFLOW_RECORD_KIND","EPISODE_TOPICS","MAX_RUN_VIEW_BYTES","SECRET_SHAPED_TEXT","applicationError","clone","deepFreeze","digest","exactObject","normalizeCommandContext","normalizePrincipal","normalizeRoute","runViewNarrowedRead","safeScopePath","scopeEntryWithin","validId","validText","workflowDefinitionPolicy","workflowEligibilityProjection","workflowRevisionBudget"]);
const RE_SOURCED = Object.freeze(["FRAME_LIMITS","contextEffectNodeBinding","createHash","normalizeWorkflowRevision"]);

const COORDINATION_READS = 15;

test('AN1: the module imports neither monolith and contains no implicit receiver at all', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/application\.mjs|coordinator\.mjs/.test(source), 'one-way import violated: ' + source);
  }
  const thisNodes = root.findAll({ rule: { kind: 'this' } });
  assert.equal(thisNodes.length, 0, 'no moved body and no relocated helper reads an implicit receiver');
});

test('AN2: every admission_port delegate keeps the member name, parameter list, and arity', () => {
  const map = JSON.parse(read(MAP_FILE));
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  const delegated = hostFile.members
    .filter((member) => member.evidence.includes('admission:application_admission_port'))
    .map((member) => member.name);
  assert.equal(delegated.length, Object.keys(ARITIES).length,
    'expected the ' + Object.keys(ARITIES).length + ' moved delegates in the map');
  assert.deepEqual([...delegated].sort(), Object.keys(ARITIES).sort(), 'the delegate set is the moved set');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const moduleFns = new Map();
  for (const fn of memberRoot.findAll({ rule: { kind: 'function_declaration' } })) {
    moduleFns.set(fn.field('name').text(), fn);
  }
  const hostText = read(HOST_FILE);
  const hostRoot = parseOf(hostText);
  const cls = hostRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'BatonApplication');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  for (const name of delegated) {
    const method = byName.get(name);
    assert.ok(method, name + ': the class must still declare it');
    const fn = moduleFns.get(name);
    assert.ok(fn, name + ': the module must declare it');
    const own = PARAMS[name];
    assert.equal(method.field('parameters')?.text() ?? '()', own,
      name + ": the delegate's parameter list must be the member's own, verbatim");
    const inner = own.slice(1, -1).replace(/\bthis\b/gu, 'application');
    const expectedModuleParams = inner ? '(application, ' + inner + ')' : '(application)';
    assert.equal(fn.field('parameters')?.text() ?? '()', expectedModuleParams,
      name + ": the module function takes (application, ...) before the member's own parameters");
    const methodText = method.text();
    assert.ok(methodText.includes('applicationAdmission.' + name + '(this'),
      name + ': the delegate must hand the application instance to the module function');
    assert.equal(methodText.startsWith('async '), ASYNC.includes(name),
      name + ': async shape must carry across the boundary exactly');
    assert.equal(BatonApplication.prototype[name].length, ARITIES[name],
      name + ": the delegate's Function.length must equal the pre-move arity");
    const fnIsAsync = fn.children().some((c) => c.kind() === 'async');
    assert.equal(fnIsAsync, ASYNC.includes(name),
      name + ": the module function's async keyword matches the pre-move member");
  }
  assert.equal(applicationAdmission._workflowRevisionEligibility.length, ARITIES._workflowRevisionEligibility + 1,
    'the module function carries the receiver as a leading parameter before the first default');
});

test('AN3: the bucket appends nothing and the durable-read census is pinned', () => {
  const moduleText = read(MEMBER_FILE);
  assert.equal((moduleText.match(/\.append\(/gu) ?? []).length, 0,
    'the admission bucket appends nothing');
  assert.equal((moduleText.match(/recordDriver\(|mapEvent\(/gu) ?? []).length, 0,
    'the admission bucket records nothing of its own');
  assert.equal((moduleText.match(/driver\??\.coordination/gu) ?? []).length, COORDINATION_READS,
    'every durable read the moved bodies made pre-move happens module-side, through the same face');
});

test('AN4: the helpers moved once; the host imports back its staying readers; the closure reads its slice-15 homes', () => {
  const moduleText = read(MEMBER_FILE);
  const hostText = read(HOST_FILE);
  const consumed = new Set([...IMPORT_BACK]);
  for (const name of RELOCATED) {
    const declMatch = moduleText.match(new RegExp('^(export )?((async )?function|const|let|var)\\s+' + name + '\\b', 'm'));
    assert.ok(declMatch, name + ': must be declared exactly once at the module top level');
    assert.equal(declMatch[0].startsWith('export'), consumed.has(name),
      name + ': exported exactly when the host reads it back');
  }
  const hostDeclRe = new RegExp('^(export )?((async )?function|const|let|var)\\s+(' + RELOCATED.join('|') + ')\\b', 'm');
  assert.doesNotMatch(hostText, hostDeclRe, 'no relocated declaration may remain at the host top level');
  const hostBackImport = hostText.match(/import \{([^}]*)\} from '\.\/application-admission\.mjs';/us);
  assert.ok(hostBackImport, 'the host must import the back-names from the module');
  const backNames = hostBackImport[1].split(',').map((s) => s.trim().replace(/,$/u, '')).filter(Boolean);
  assert.deepEqual(backNames.sort(), [...IMPORT_BACK].sort(), 'the import-back list is exactly the staying readers');
  const obsImport = moduleText.match(/import \{([^}]*)\} from '\.\/application-observation\.mjs';/us);
  assert.ok(obsImport, 'the admission module must read the slice-15 exports from their own module');
  const obsNames = obsImport[1].split(',').map((s) => s.trim().replace(/,$/u, '')).filter(Boolean);
  assert.deepEqual(obsNames.sort(), [...OBSERVATION_IMPORTS].sort(), 'the observation-import list is exactly the shared slice-15 exports');
});

test('AN5: the map sees the move — a new target, the host unchanged, every delegate on the port rule', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact must carry the application-admission target');
  assert.equal(target.members.length, 48);
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  assert.equal(hostFile.members.length, 237, 'application.mjs keeps every member as delegates');
  for (const member of hostFile.members) {
    if (!Object.hasOwn(ARITIES, member.name)) continue;
    assert.ok(member.evidence.includes('admission:application_admission_port'),
      member.name + ': the delegate reads on the port rule');
  }
});
