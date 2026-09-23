// application-observation.test.mjs — issue #259, slice 15. Pins the module the application's
// observation bucket moved into (impl/src/application-observation.mjs — 80 members: the
// run, workflow, context and episode projections with the projection helpers they compose)
// against the bare 'application' receiver, and the BatonApplication class that now delegates to
// it. Five claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither application.mjs nor
//      coordinator.mjs and contains no 'this' at all. Moved bodies read the application through
//      the explicit first parameter; BatonApplication owns no recorder, so no port rides along.
//   2. SAME NAME, SAME ARITY, SAME RECEIVER — every delegate the seam map shows as
//      observation:application_observation_port keeps the member's own parameter list and arity
//      on both sides of the boundary; the module function's parameter list is the member's own
//      with 'application' prepended; the 11 async members keep async.
//   3. THE READS ARE THE RECORDING — the bucket appends nothing: zero append calls in the
//      module, and the durable-read census (136 driver-coordination reads) is pinned
//      against the pre-move source, member for member.
//   4. THE HELPERS MOVED ONCE — the 142 relocated module-scope declarations
//      (94 functions, 48 consts) are declared exactly once, module-side; the host
//      imports back exactly the 108 its staying code reads and re-exports the 18 its
//      CLI/MCP/Web consumers import from it; the 31 shared import bindings re-import
//      from their original modules.
//   5. THE MAP SEES THE MOVE — the committed artifact carries the application-observation target
//      with 175 members, application.mjs stays at 241, and every moved delegate keeps
//      observation through the application_observation_port rule.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as applicationObservation from '../src/application-observation.mjs';
import { BatonApplication } from '../src/application.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/application-observation.mjs';
const HOST_FILE = 'impl/src/application.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const ARITIES = Object.freeze({"_loadProfileRegistry":0,"_semanticControlTargets":1,"_runControls":0,"_controlOperationalState":1,"_beginRunControlEffect":1,"_acknowledgeRunControl":3,"_settleRunControl":3,"_runControlView":2,"_findRun":1,"_workflowPlanHistoryPolicyBound":1,"_workflowPlanHistory":1,"_completedResultExport":1,"openResultExportArchive":1,"registerResultExportDelivery":1,"_performResultExport":1,"_semanticTarget":2,"_performResultAdoption":1,"_performRunStop":1,"_recursiveLease":2,"_recursiveAuth":3,"_goalPlanStatus":2,"_buildWorkflowEvidence":2,"_performRunVerificationRetry":1,"_cancelRunVerificationRetry":1,"_finalizeRunView":2,"_planningView":1,"_historicalProfileView":2,"_workflowDefinitionAncestors":1,"_workflowDefinition":1,"_workflowSuccessorDefinitionCore":1,"_workflowRevisionDefinition":1,"_workflowCandidates":3,"_workflowSelection":3,"_workflowFeedback":3,"_workflowMemberStops":2,"_performWorkflowMemberStop":3,"_workflowRevisionFeedbackRows":2,"_workflowRoundSummaries":2,"_buildWorkflowView":2,"_eventBelongsToRun":2,"_knowledgeProjection":1,"_activityProjection":1,"_progressTiming":2,"_semanticProgressProjection":3,"_followPage":3,"_contextState":1,"_withContextProjection":2,"_contextTargets":2,"_contextEvalTargets":2,"_contextSectionItems":1,"_contextItemDetail":1,"_contextItemContent":3,"_contextItemEvidence":2,"_contextProviderResultRequests":3,"_proposeContextMap":3,"_proposeContextReduce":3,"_proposeContextRetry":3,"contextEval":2,"contextPackageBranch":3,"_semanticActions":3,"_episodeContext":2,"_episodeGraph":2,"_episodeItem":3,"_episodeEvidence":3,"_closedVerdictProjection":4,"_semanticSectionItems":3,"_runTimelineContent":3,"_episodeOutputContent":3,"_runProgressContent":2,"_historicalProfileInspection":3,"_debugMember":3,"_debugReceipt":1,"_activeWorkstream":2,"_waveDriverDetached":1,"_runWaveIndex":0,"_runWaveId":1,"_runWaveRole":1,"_runWaveRoute":1,"_pagePreservedInspections":2,"_runIdForWaveMember":2});

const PARAMS = Object.freeze({"_loadProfileRegistry":"()","_semanticControlTargets":"(current)","_runControls":"(runId = null)","_controlOperationalState":"(control)","_beginRunControlEffect":"(control)","_acknowledgeRunControl":"(control, state, outcome)","_settleRunControl":"(control, state, outcome)","_runControlView":"(current, settled)","_findRun":"(runId, { allowUnavailableProfile = false } = {})","_workflowPlanHistoryPolicyBound":"(current)","_workflowPlanHistory":"(current)","_completedResultExport":"(coordinates)","openResultExportArchive":"(coordinates)","registerResultExportDelivery":"({ runId, exportId, signal, abort })","_performResultExport":"(state)","_semanticTarget":"(current, view)","_performResultAdoption":"(adoption)","_performRunStop":"(stop)","_recursiveLease":"(principal, context)","_recursiveAuth":"(principal, context, key)","_goalPlanStatus":"(current, observer)","_buildWorkflowEvidence":"(current, view)","_performRunVerificationRetry":"(admission)","_cancelRunVerificationRetry":"(pending)","_finalizeRunView":"(current, view, options = {})","_planningView":"(current, cause = null, principal = this.principals.observer, options = {})","_historicalProfileView":"(current, observer, options = {})","_workflowDefinitionAncestors":"(runId, excludeDigest = null, beforeSeq = Infinity)","_workflowDefinition":"(current)","_workflowSuccessorDefinitionCore":"({\n    current, predecessorCurrent = current, planDigest, node, predecessorDefinition,\n    revision, policy, targetSchemaVersion = 3,\n  })","_workflowRevisionDefinition":"(current, record = null)","_workflowCandidates":"(current, projection, definition)","_workflowSelection":"(current, definition, candidates)","_workflowFeedback":"(current, definition, candidates)","_workflowMemberStops":"(current, definition)","_performWorkflowMemberStop":"(current, definition, stop)","_workflowRevisionFeedbackRows":"(feedback, candidate)","_workflowRoundSummaries":"(current, observer)","_buildWorkflowView":"(current, observer, options = {})","_eventBelongsToRun":"(event, current)","_knowledgeProjection":"(runId)","_activityProjection":"(current, workers = [])","_progressTiming":"(current, view)","_semanticProgressProjection":"(current, view, principal)","_followPage":"(current, view, afterCursor)","_contextState":"(current)","_withContextProjection":"(current, view)","_contextTargets":"(current, view)","_contextEvalTargets":"(current, view)","_contextSectionItems":"(current)","_contextItemDetail":"(selected)","_contextItemContent":"(selected, offset, bounds)","_contextItemEvidence":"(current, selected)","_contextProviderResultRequests":"(call, children, cleanup)","_proposeContextMap":"(current, inputs, caller)","_proposeContextReduce":"(current, inputs, caller)","_proposeContextRetry":"(current, inputs, caller)","contextEval":"(rawRequest, rawPrincipal, rawContext = null)","contextPackageBranch":"(packageDigest, branchName, rawPrincipal, rawContext = null)","_semanticActions":"(current, view, principal, context = null)","_episodeContext":"(current, view)","_episodeGraph":"(current, view, role = null, episodeContext = null, generation = null)","_episodeItem":"(current, view, topic, role = null, episodeContext = null, generation = null)","_episodeEvidence":"(current, view, selected, episodeContext = null)","_closedVerdictProjection":"(result, planNode, phase, workerId)","_semanticSectionItems":"(current, view, sectionId, episodeContext = null)","_runTimelineContent":"(current, request, bounds, snapshot = null, taskIds = null)","_episodeOutputContent":"(current, request, bounds, episodeContext = null)","_runProgressContent":"(current, view)","_historicalProfileInspection":"(current, view, request)","_debugMember":"(dispatch, runId, limit)","_debugReceipt":"(event)","_activeWorkstream":"(rawRequest, principal)","_waveDriverDetached":"(waveId)","_runWaveIndex":"()","_runWaveId":"(runId, index = null)","_runWaveRole":"(runId, index = null)","_runWaveRoute":"(runId, index = null)","_pagePreservedInspections":"(page, waveIndex)","_runIdForWaveMember":"(waveId, waveRole, index = null)"});

const ASYNC = Object.freeze(["_goalPlanStatus","_historicalProfileView","_workflowRoundSummaries","_buildWorkflowView","_proposeContextMap","_proposeContextReduce","_proposeContextRetry","contextEval","contextPackageBranch","_activeWorkstream","_pagePreservedInspections"]);

/** The relocated module-scope declarations, sorted. */
const RELOCATED = Object.freeze(["ACTION_INPUT_ENVELOPE","ACTION_TURN_RESPONSE_KIND","APPLICATION_PROFILE_RECORD_ACTOR","APPLICATION_PROFILE_RECORD_KIND","APPLICATION_RUN_TERMINAL_PHASES","APPLICATION_STEERING_REGISTERED_KIND","APPLICATION_WAVE_DRIVER_DETACHED_KIND","APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND","APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND","APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND","APPLICATION_WORKFLOW_RECORD_ACTOR","APPLICATION_WORKFLOW_RECORD_KIND","APPLICATION_WORKFLOW_SELECTION_RECORD_KIND","ATTENTION_PAGE_BYTES","CONTEXT_EVAL_ARGS","DEBUG_GATE_CODES","EPISODE_TOPICS","EXPLICIT_RESULT_CONSTRAINTS","HEX64","LEGACY_READ_ONLY_RESULT_CONSTRAINT","MAX_ATTENTION","MAX_ATTENTION_TEXT_BYTES","MAX_BLOCKED_INTERACTION_SUMMARY_BYTES","MAX_PROFILE_BYTES","MAX_RUN_RECORDS","MAX_RUN_VIEW_BYTES","MAX_SCRATCHPAD_VIEW_BYTES","MAX_SCRATCHPAD_VIEW_CACHE_KEYS","MAX_SCRATCHPAD_VIEW_ITEMS","NOISE_TELEMETRY_OPERATIONAL_KINDS","PROVIDER_EXECUTION_SETTLED_PHASES","READ_ONLY_RESULT_DEFINITION","RESULT_POLICY_CONSTRAINT_PREFIX","ROUTE_AXES","RUN_VIEW_SHED_STEPS","VERDICT_CHECK_PHASES","VERDICT_CORRECTIVE_TABLE","VERDICT_SURFACE_CORRECTIVE_FORCED","VERIFIER_DIAGNOSTIC_CODES","VERIFIER_DURATION_BOUND_MS","VERIFIER_EXECUTION_CODES","VERIFIER_EXECUTION_STATES","VERIFIER_OUTCOMES","VERIFIER_OWNERSHIPS","actionDoInputs","adoptionState","applicationError","assertResultIntentCoherence","assertWorkflowFeedbackAnchors","authority","boundedAttentionText","boundedBlockedInteractionSummary","boundedPlanNodes","byteBoundedPage","canonical","capBytesToScalar","capabilityEligibleSemanticActions","clone","closedEnum","debugFrameDegradedSummary","debugGateDetail","debugGateFromLiveCode","debugGateRefusal","debugTerminalCode","deepFreeze","digest","exactDispatchRoute","exactObject","exactPlanNodeRoute","exactPlanRoutes","explicitRouteEvidence","goalPlanDispatchesPage","goalPlanReadAll","goalPlanRunPlansPage","goalPlanStorePage","isVerdictCandidate","normalizeBudget","normalizeCommandContext","normalizeExportPolicy","normalizeFollowPolicy","normalizeGateCauseFeedback","normalizeIntegrationPolicy","normalizePrincipal","normalizeProfile","normalizeProfileRegistryEvent","normalizeRecoveryPolicy","normalizeResultPolicy","normalizeReviewPolicy","normalizeRoute","normalizeSemanticAuthority","normalizeStringSet","normalizeVerification","normalizeWorkflowFeedback","objectiveFirstLine","objectiveReach","objectiveResultPolicy","parseProfileConstraint","profileDefinition","profileRegistryCoordinate","profileRegistryKey","progressBlockedDetail","projectBlockedInteraction","projectContextPackageBranch","projectDecisionAttention","projectPlanRouteAuthority","projectProgressClass","projectRouteAttestation","projectRunRouteEvidence","projectScratchpadContent","projectScratchpadView","projectVerdictSurface","projectWaitingOn","projectedCleanupState","refs","requestedPlanNodeRoute","resultExportArchiveCeiling","resultIntentConstraint","resultIntentFromConstraints","runActivity","runProgress","runViewNarrowedRead","runWorkerOwnership","safeScopePath","sanitizeHex64","scopeEntryWithin","scratchpadProse","semanticAuthorityPayload","semanticViewDigest","sessionAttachmentUnproven","terminalCauseNarrative","validId","validText","validateContextEvalArgs","verdictForgedCorrectiveReason","verdictLiveCode","verdictSurfaceCheck","verdictSurfaceDetail","workflowDefinitionPolicy","workflowEligibilityProjection","workflowNodeBudget","workflowRevisionBudget"]);

/** The host's import-back list and its re-export list for external consumers. */
const IMPORT_BACK = Object.freeze(["ACTION_INPUT_ENVELOPE","ACTION_TURN_RESPONSE_KIND","APPLICATION_PROFILE_RECORD_ACTOR","APPLICATION_PROFILE_RECORD_KIND","APPLICATION_RUN_TERMINAL_PHASES","APPLICATION_STEERING_REGISTERED_KIND","APPLICATION_WAVE_DRIVER_DETACHED_KIND","APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND","APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND","APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND","APPLICATION_WORKFLOW_RECORD_ACTOR","APPLICATION_WORKFLOW_RECORD_KIND","APPLICATION_WORKFLOW_SELECTION_RECORD_KIND","ATTENTION_PAGE_BYTES","EPISODE_TOPICS","EXPLICIT_RESULT_CONSTRAINTS","MAX_ATTENTION","MAX_ATTENTION_TEXT_BYTES","MAX_RUN_RECORDS","MAX_RUN_VIEW_BYTES","MAX_SCRATCHPAD_VIEW_ITEMS","NOISE_TELEMETRY_OPERATIONAL_KINDS","PROVIDER_EXECUTION_SETTLED_PHASES","READ_ONLY_RESULT_DEFINITION","RESULT_POLICY_CONSTRAINT_PREFIX","RUN_VIEW_SHED_STEPS","VERDICT_CORRECTIVE_TABLE","VERIFIER_DIAGNOSTIC_CODES","VERIFIER_DURATION_BOUND_MS","VERIFIER_EXECUTION_CODES","VERIFIER_EXECUTION_STATES","VERIFIER_OUTCOMES","VERIFIER_OWNERSHIPS","actionDoInputs","adoptionState","applicationError","assertResultIntentCoherence","assertWorkflowFeedbackAnchors","authority","boundedAttentionText","boundedBlockedInteractionSummary","boundedPlanNodes","byteBoundedPage","capBytesToScalar","capabilityEligibleSemanticActions","clone","closedEnum","debugFrameDegradedSummary","debugGateFromLiveCode","debugGateRefusal","debugTerminalCode","deepFreeze","digest","exactObject","exactPlanNodeRoute","exactPlanRoutes","goalPlanDispatchesPage","goalPlanReadAll","goalPlanRunPlansPage","goalPlanStorePage","normalizeCommandContext","normalizePrincipal","normalizeProfile","normalizeProfileRegistryEvent","normalizeRoute","normalizeSemanticAuthority","normalizeWorkflowFeedback","objectiveFirstLine","objectiveReach","objectiveResultPolicy","parseProfileConstraint","profileDefinition","profileRegistryCoordinate","profileRegistryKey","projectBlockedInteraction","projectContextPackageBranch","projectDecisionAttention","projectPlanRouteAuthority","projectProgressClass","projectRunRouteEvidence","projectScratchpadView","projectVerdictSurface","projectWaitingOn","projectedCleanupState","refs","requestedPlanNodeRoute","resultExportArchiveCeiling","resultIntentConstraint","resultIntentFromConstraints","runActivity","runProgress","runViewNarrowedRead","runWorkerOwnership","safeScopePath","sanitizeHex64","scopeEntryWithin","semanticAuthorityPayload","semanticViewDigest","sessionAttachmentUnproven","terminalCauseNarrative","validId","validText","validateContextEvalArgs","workflowDefinitionPolicy","workflowEligibilityProjection","workflowNodeBudget","workflowRevisionBudget"]);
const HOST_REEXPORTS = Object.freeze(["APPLICATION_RUN_TERMINAL_PHASES","MAX_SCRATCHPAD_VIEW_BYTES","MAX_SCRATCHPAD_VIEW_CACHE_KEYS","MAX_SCRATCHPAD_VIEW_ITEMS","PROVIDER_EXECUTION_SETTLED_PHASES","VERDICT_CORRECTIVE_TABLE","actionDoInputs","byteBoundedPage","goalPlanDispatchesPage","goalPlanReadAll","goalPlanRunPlansPage","projectContextPackageBranch","projectProgressClass","projectRouteAttestation","projectRunRouteEvidence","projectScratchpadView","projectVerdictSurface","semanticViewDigest"]);

const COORDINATION_READS = 136;

test('AO1: the module imports neither monolith and contains no implicit receiver at all', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/application\.mjs|coordinator\.mjs/.test(source), 'one-way import violated: ' + source);
  }
  const thisNodes = root.findAll({ rule: { kind: 'this' } });
  assert.equal(thisNodes.length, 0, 'no moved body and no relocated helper reads an implicit receiver');
});

test('AO2: every observation_port delegate keeps the member name, parameter list, and arity', () => {
  const map = JSON.parse(read(MAP_FILE));
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  const delegated = hostFile.members
    .filter((member) => member.evidence.includes('observation:application_observation_port'))
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
    assert.ok(methodText.includes('applicationObservation.' + name + '(this'),
      name + ': the delegate must hand the application instance to the module function');
    assert.equal(methodText.startsWith('async '), ASYNC.includes(name),
      name + ': async shape must carry across the boundary exactly');
    assert.equal(BatonApplication.prototype[name].length, ARITIES[name],
      name + ": the delegate's Function.length must equal the pre-move arity");
    const fnIsAsync = fn.children().some((c) => c.kind() === 'async');
    assert.equal(fnIsAsync, ASYNC.includes(name),
      name + ": the module function's async keyword matches the pre-move member");
  }
  assert.equal(applicationObservation._findRun.length, ARITIES._findRun + 1,
    'the module function carries the receiver as a leading parameter before the first default');
});

test('AO3: the bucket appends nothing and the durable-read census is pinned', () => {
  const moduleText = read(MEMBER_FILE);
  assert.equal((moduleText.match(/\.append\(/gu) ?? []).length, 0,
    'the observation bucket appends nothing — no log, no ledger, anywhere in the module');
  assert.equal((moduleText.match(/mapEvent\(/gu) ?? []).length, 0,
    'no mapEvent spelling exists — the bucket never reached the coordinator recorder');
  assert.equal((moduleText.match(/recordDriver\(/gu) ?? []).length, 4,
    'the four store recordDriver writes ride along verbatim, through the same driver.coordination face');
  assert.equal((moduleText.match(/driver\??\.coordination/gu) ?? []).length, COORDINATION_READS,
    'every durable read (131 from the moved bodies, 4 from the relocated projection helpers, 1 from the issue-140 tail-scan helper) happens module-side, through the same face');
});
test("AO4: the helpers moved once; the host imports back its staying readers and re-exports its consumers' names", () => {
  const moduleText = read(MEMBER_FILE);
  const hostText = read(HOST_FILE);
  const consumed = new Set([...IMPORT_BACK, ...HOST_REEXPORTS]);
  for (const name of RELOCATED) {
    const declMatch = moduleText.match(new RegExp('^(export )?((async )?function|const|let|var)\\s+' + name + '\\b', 'm'));
    assert.ok(declMatch, name + ': must be declared exactly once at the module top level');
    assert.equal(declMatch[0].startsWith('export'), consumed.has(name),
      name + ': exported exactly when the host or its external consumers read it');
  }
  const hostDeclRe = new RegExp('^(export )?((async )?function|const|let|var)\\s+(' + RELOCATED.join('|') + ')\\b', 'm');
  assert.doesNotMatch(hostText, hostDeclRe, 'no relocated declaration may remain at the host top level');
  const hostBackImport = hostText.match(/import \{([^}]*)\} from '\.\/application-observation\.mjs';/us);
  assert.ok(hostBackImport, 'the host must import the back-names from the module');
  const backNames = hostBackImport[1].split(',').map((s) => s.trim().replace(/,$/u, '')).filter(Boolean);
  assert.deepEqual(backNames.sort(), [...consumed].sort(),
    'the host imports the staying readers plus the names its export clause re-exports');
  assert.ok(IMPORT_BACK.every((n) => backNames.includes(n)), 'every staying reader is imported');
  const hostReexport = hostText.match(/export \{([^}]*)\};/us);
  assert.ok(hostReexport, 'the host must re-export the consumer-facing names');
  const reexportNames = hostReexport[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(reexportNames.sort(), [...HOST_REEXPORTS].sort(), 'the re-export list is exactly the external surface');
});

test('AO5: the map sees the move — a new target, the host unchanged, every delegate on the port rule', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact must carry the application-observation target');
  assert.equal(target.members.length, 175);
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  assert.equal(hostFile.members.length, 242, 'application.mjs carries the turn-consumer admission method and existing delegates');
  for (const member of hostFile.members) {
    if (!Object.hasOwn(ARITIES, member.name)) continue;
    assert.ok(member.evidence.includes('observation:application_observation_port'),
      member.name + ': the delegate reads on the port rule');
  }
});
