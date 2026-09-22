// runtime-observation.test.mjs — issue #259, slice 10. Pins the module the coordinator's
// observation bucket moved into (impl/src/runtime-observation.mjs — 142 members: the read
// projections and the write-receipt minters) against the injected recorder port (slice 6), and the
// coordinator that now delegates to it. Five claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith and contains no
//      `this` at all: no error classes relocated this time. Moved bodies read the coordinator
//      through the explicit `coordinator` parameter and record through the explicit `recorder`.
//   2. SAME NAME, SAME ARITY, SAME PORT — every delegate the seam map shows as `observation_port`
//      keeps the member's own parameter list and arity on both sides of the boundary and hands the
//      class's recorder (`this._recorder`) to the module function; the two generator members
//      delegate with `yield*`.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — the reroute census is pinned against the source
//      (36 log appends, 16 evidence maps, 6 driver records, 145 coordination calls across the
//      bucket), and a real spawn proves the instance-patch contract across the module boundary: a
//      stubbed observation member fires from inside the moved `_dispatch`.
//   4. THE HELPERS MOVED ONCE — the 11 relocated coordinator-scope declarations are exported by the
//      module; exactly the three a staying member still reads (closedVerificationVerdict, noop,
//      pathInScope) are imported back.
//   5. THE MAP SEES THE MOVE — the committed artifact carries the runtime-observation target with
//      150 members (142 bodies + 8 relocated helper functions; slice 12 moved noop and
//      closedVerificationVerdict to the runtime-recovery base layer, where the effect seam's
//      _integrate reads the verdict helper without an effects -> observation cycle — this
//      module's surface holds them as re-exports), every class delegate keeps `observation`,
//      and the 16 bodies whose evidence thins to admission/surface on the port spelling are
//      named.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeObservation from '../src/runtime-observation.mjs';
import { Coordinator } from '../src/coordinator.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-observation.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const ARITIES = Object.freeze({"providerFaultDeathFor":1,"drain":0,"releaseTerminalTaskResources":2,"_pendingInteractionFor":1,"pausedTurnStatus":1,"pausedTurns":0,"workerActivity":1,"lastToolRows":1,"_contributionOperations":0,"_pausedActTargets":1,"_expirePreNudgeScratchClaims":3,"waitTurn":1,"claimTurn":1,"_claimReservedTurn":3,"_recordDrainDisposition":4,"_mirrorDrainDispositions":4,"_cancelPendingForDrain":1,"_settledDrainHolder":1,"_recordDrainReleases":3,"_recordDrainCustodyRetained":3,"_deferTaskDispatch":2,"_semanticControlBinding":1,"_exactProcesslessPreservationAuthority":2,"_failWorkerPolicyObservation":3,"_failWorktreeAuthority":1,"_providerRoutePolicy":1,"_releaseProviderTurnAdmission":2,"_mintAttentionSpill":1,"_citedReplObjects":3,"_resolveReplSpill":1,"_replManifestReview":1,"_replCiteInOwnRun":2,"_pendingAttentionPush":1,"_knownAttentionIds":1,"_attentionReceipt":1,"_onSpawnRefused":4,"_seedCoordinationTasks":0,"_seedCoordinationTasksPasses":0,"_knownSessionContext":2,"_failPreservedReattachment":3,"inspectPreservedResult":2,"_completeRetryCancelled":2,"requestPublication":1,"_workerPolicyProjection":1,"_taskTopologyProjection":1,"_activeMessageMember":1,"_messagePeers":2,"messageReceipt":1,"_isReviewAuthority":2,"_attentionPage":4,"_mintMemberTerminal":3,"_send":3,"_rejectContradictoryAdmission":3,"_prepareSemanticInterrupt":2,"_observeEmergencyTerminal":1,"_coordTransition":3,"_settlePlanNodeBudget":1,"_coordMap":2,"_coordMapEvent":1,"_coordRecord":3,"_createCoordinationRefinement":3,"_expireScratchClaims":3,"_expireBoardClaims":3,"_releaseRetainedCheckout":2,"registerParticipantRuntime":2,"_clearWatchdog":1,"_armWatchdog":1,"_resetWatchdogTurn":1,"_touchWatchdog":1,"_applyWatchdogAction":2,"_mintStallDeclared":1,"_armStallCycle":3,"_expireStallCycle":1,"_expireStallCycleSafely":1,"recordedFailures":0,"_recordOperationFailure":4,"_cleanupTransportInBackground":2,"_recordTrustGateEscape":2,"_clearStall":1,"_observeStallSeam":2,"_scheduleScopeOrientation":2,"_recordProviderGovernanceViolation":2,"_recordProviderTelemetryInvalid":2,"_recordProviderTurnUsage":2,"_recordUsage":2,"_failTerminalProviderGovernance":3,"_observeLogicalProviderCall":2,"_observeLogicalToolCall":2,"_clearBudgetStop":1,"_observeWatchdogEvent":2,"_observeTurnProgress":2,"_wireAck":4,"_observeKillAbsence":1,"_attestAbsentStop":4,"_abandonStopWorker":1,"_expireQuestion":3,"_mintInteractionExpired":4,"_cancelNativeQuestion":2,"_supersedeDecision":3,"readProviderStatus":0,"recallKnowledge":1,"serveKnowledge":1,"claimScratch":2,"postScratchFact":2,"writeScratchpad":2,"_settleTerminalScratchpad":1,"settleWorkflowScratchpad":2,"contextRead":2,"_answerContextRead":4,"_renderContextRead":1,"_recordOrientationRating":2,"_runHorizonNodeIds":1,"readScratch":3,"acquireBoardLease":1,"requestBoardClaim":2,"submitBoardReport":2,"mintMemberBoardGrant":2,"_waveRoleOf":1,"_waveIdOf":1,"recordWorkerGeneration":1,"elevateTaskScratchpad":2,"promoteWorkflowFinding":5,"_settlementMemberTask":1,"settlementLease":2,"_bumpInteractionGeneration":1,"_bumpDecisionSettleCount":1,"decisionSettledProjection":1,"taskHorizon":1,"workflowHorizon":1,"projectHorizon":1,"boardFence":1,"boardSnapshot":1,"dropReplBinding":1,"bindingFence":2,"replBindingSnapshot":2,"resolveReplCitation":2,"_lastDeathCertEvidence":1,"_collectDigest":0,"_recordProviderQuotaBlock":3,"_settleTransportDeath":2,"_mintProviderFaultDeath":2,"_foldProviderDegrade":3,"_recordProviderDegrade":3,"_settleObservedNativeChildren":1,"_failProviderResult":3,"_terminalizeUnattachedCoordinationTasks":0});

const GENERATORS = Object.freeze(['_seedCoordinationTasksPasses', '_terminalizeUnattachedCoordinationTasks']);

/** The helpers relocated out of the coordinator's module scope; the second list is the import-back. */
const RELOCATED = Object.freeze([
  'ATTENTION_COALESCE_WINDOW_MS', 'PROVIDER_AUTH_EXPIRED', 'closedVerificationVerdict', 'noop',
  'pathInScope', 'permissionsForWaveRole', 'projectHorizonScratchpad', 'settlementCandidacyTitle',
  'workerEditedPathsOf', 'workerObservedCommitsOf', 'workerToolTitleOf',
  // the transitive closure of the seed helpers' coordinator-local dependencies — a relocated helper
  // that reads an unrelocated name throws ReferenceError at call time
  'CLOSED_VERIFIER_DIAGNOSTICS', 'CLOSED_VERIFIER_EXECUTIONS', 'CLOSED_VERIFIER_OUTCOMES',
  'CLOSED_VERIFIER_OWNERS', 'TURN_PROGRESS_COMMIT_RE', 'boolOrNull', 'closedExecution', 'globRegex',
  'hex64OrNull', 'intOrNull',
]);
const IMPORTED_BACK = Object.freeze(['closedVerificationVerdict', 'noop', 'pathInScope']);

/** The bodies whose module-side evidence thins on the port spelling (recorder.coordination is not
 * the catalogue's this._coordination): the class delegates pin the seam; these are the members. */
const RECLASSIFIED = Object.freeze([
  ['drain', 'admission'], ['_semanticControlBinding', 'surface'], ['_isReviewAuthority', 'admission'],
  ['_attentionPage', 'admission'], ['_send', 'surface'], ['readProviderStatus', 'admission'],
  ['claimScratch', 'admission'], ['postScratchFact', 'admission'], ['writeScratchpad', 'admission'],
  ['_answerContextRead', 'admission'], ['_recordOrientationRating', 'admission'],
  ['boardFence', 'admission'], ['boardSnapshot', 'admission'], ['bindingFence', 'admission'],
  ['replBindingSnapshot', 'admission'], ['resolveReplCitation', 'admission'],
]);

/** The reroute census across the bucket, as generated and verified against the source. */
const REROUTE_TOTALS = Object.freeze({ logAppend: 36, mapEvent: 16, coordRecord: 6, coordination: 154 });

test('RO1: the module imports neither monolith and contains no implicit receiver at all', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  const thisNodes = root.findAll({ rule: { kind: 'this' } });
  assert.equal(thisNodes.length, 0, 'no member body and no relocated helper reads an implicit receiver');
});

test('RO2: every observation_port delegate keeps the member name, parameter list, and hands over the recorder', () => {
  const map = JSON.parse(read(MAP_FILE));
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('observation:observation_port'))
    .map((member) => member.name);
  assert.equal(delegated.length, 146, `expected the 146 moved delegates in the map, found ${delegated.length}`);
  assert.ok(!delegated.includes('_providerBrief'),
    '_providerBrief stays slice 3\'s briefing-port delegate — not double-hopped through this module');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  const coordText = read(COORD_FILE);
  const coordRoot = parseOf(coordText);
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  for (const name of delegated) {
    const method = byName.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    assert.ok(memberParams.has(name), `${name}: the module must export it`);
    const moduleOwn = memberParams.get(name).replace(/^\(coordinator, recorder,?\s*/u, '(')
      .replaceAll('coordinator.', 'this.');
    assert.equal(method.field('parameters')?.text() ?? '()', moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (module takes coordinator, recorder first; receiver spellings normalized)`);
    const delegateText = method.text();
    assert.ok(delegateText.includes(`runtimeObservation.${name}(this, this._recorder`),
      `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    if (GENERATORS.includes(name)) {
      assert.ok(delegateText.includes(`yield* runtimeObservation.${name}(`),
        `${name}: a generator member delegates with yield* (slice-8 contract)`);
    } else {
      assert.ok(delegateText.includes(`return runtimeObservation.${name}(`), `${name}: a plain delegate returns the call`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(Coordinator.prototype, name);
    assert.ok(descriptor, `${name}: the class must still answer on ${name}`);
    assert.equal(descriptor.value.length, ARITIES[name], `${name}: the signature must not move with the body`);
  }
});

test('RO3: the recorder is the only recording path — census pinned, and instance patches fire across the boundary', async () => {
  const text = read(MEMBER_FILE);
  // Count inside the function bodies only — the module header names the port spellings in prose.
  const codeOnly = parseOf(text).findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })
    .map((fn) => fn.text()).join('\n');
  const totals = {
    logAppend: codeOnly.split('recorder.log.append(').length - 1,
    mapEvent: codeOnly.split('recorder.mapEvent(').length - 1,
    coordRecord: codeOnly.split('recorder.recordDriver(').length - 1,
    coordination: codeOnly.split('recorder.coordination').length - 1,
  };
  assert.deepEqual(totals, REROUTE_TOTALS,
    'the bucket records through the port exactly as many times as the pre-move bodies recorded through the class');
  assert.equal(text.includes('this._log.append('), false, 'no moved body reaches the log beside the port');
  assert.equal(text.includes('this._coordination'), false, 'no moved body reaches the store beside the port');

  // The instance-patch contract, behaviorally: a spawn drives the moved _dispatch, whose body
  // self-calls recordWorkerGeneration (observation bucket) THROUGH the class — an instance stub
  // must fire.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'baton-ro3-'));
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native' } }),
    _onEvent: null,
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    spawn() { return Promise.resolve({ ok: true }); },
    async kill() {},
    async interrupt() {},
  };
  const worktrees = {
    async create(taskId) { return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
    async remove() {},
  };
  try {
    const log = new Log(join(dir, 'log'));
    const coordinator = new Coordinator({
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: { mock: adapter },
      worktrees,
      capabilities: null,
      referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
      route: () => 'mock',
      now: (() => { let t = 0; return () => t; })(),
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    });
    let patched = 0;
    const original = coordinator.recordWorkerGeneration;
    coordinator.recordWorkerGeneration = (handle) => { patched += 1; return original.call(coordinator, handle); };
    const handle = await coordinator.spawn('mock', {
      goal: 'ro3', constraints: [], pathScope: ['.'],
      definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 1000, usd: 1, wallMin: 5 },
    });
    assert.equal(patched, 1,
      'the instance stub on an observation member fired from inside the moved _dispatch — the self-call routed through the class');
    const stopping = coordinator.kill(handle.id, 'test_done');
    adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
    await stopping;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RO4: the eleven relocated helpers moved once; exactly three are imported back', () => {
  const coordText = read(COORD_FILE);
  for (const name of RELOCATED) {
    assert.ok(Object.hasOwn(runtimeObservation, name), `${name}: the module exports it`);
  }
  const importBack = coordText.match(/import \{[^}]*\} from '\.\/runtime-observation\.mjs';/gsu) ?? [];
  const names = importBack.flatMap((statement) => [...statement.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/gu)]
    .map((m) => m[1])
    .filter((n) => !['import', 'from', 'runtime', 'observation', 'mjs'].includes(n)));
  for (const name of IMPORTED_BACK) {
    assert.ok(names.includes(name), `${name}: a staying member still reads it — it must be imported back`);
  }
  for (const name of RELOCATED.filter((n) => !IMPORTED_BACK.includes(n))) {
    assert.ok(!names.includes(name), `${name}: only moved members read it — no dead import-back`);
  }
});

test('RO5: the map sees the move', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-observation target');
  assert.equal(target.members.length, 157,
    'the module target carries the moved bodies plus the relocated helper functions; issue #69 added the resolution side of the cited-REPL-object lane, whose guards live in the admission bucket');
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegates = coordinatorFile.members.filter((member) => member.evidence.includes('observation:observation_port'));
  for (const member of delegates) {
    assert.equal(member.seam, 'observation', `${member.name}: the delegate keeps the observation seam`);
  }
  const byName = new Map(target.members.map((member) => [member.name, member]));
  for (const [name, seam] of RECLASSIFIED) {
    assert.equal(byName.get(name)?.seam, seam,
      `${name}: the module body's seam on the port spelling is the named one`);
  }
});
