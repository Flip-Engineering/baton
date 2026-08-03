// Board worker-half red suite (epic #78; contract: docs/reference/evidence/
// frontier-sweep-2026-08-03/board-workerhalf-contract.md v1.0 — red-team-folded).
//
// Twenty-four rows over the folded decisions: D1 worker-profile claim/report rows + closed
// stream frames (BW-01/02/24), D2 waves.send-minted member-bound grants (BW-03/04/05/22), D3
// the S-2-shaped worker admission seam (BW-04/06/22), D4 the claim-CAS/report-CAS fence law
// (BW-07/08/09/10), D5 grant-scoped L1 reads (BW-13/15/16), D6 idempotency/replay
// (BW-11/12/23), D7 the triage envelope (BW-14/19/20), D8 event-based lifecycle (BW-17/18).
//
// Red-first: written against the v1.0 contract BEFORE implementation. Every red row fails
// today for its named stage — registry ghosts (surfaces: [], no live dispatch), the missing
// worker stream dispatch (no board.claim/board.report case on the authenticated event
// switch), the missing claimGrant transport on waves.send (the closed normalizer refuses the
// key today), the missing worker admission seam / grant machinery, the blind kernel _byKey
// replay return, the orchestrator close/drop batch that never expires the item's claim, the
// boardFence-only projection cache, the unrecorded/unenforced grant permission subset
// (BW-22), the missing replay-wins-over-live-state seam adjudication (BW-23), the missing
// BOARD_CLAIM/BOARD_REPORT wire scanner (BW-24), and the missing durable generation record
// (BW-12) — and goes green ONLY on a contract-correct implementation. Pin rows (BW-07/09/10)
// are green today and guard behavior the contract says is unchanged. Harness patterns mirror
// test/bidirectional-v3-red.test.mjs (ScriptableAdapter + Coordinator + fake worktrees),
// test/reflex2-boards-red.test.mjs and test/board-authority-red.test.mjs (pure
// CoordinationStore + S-2 authority fixture), test/phase49-cairn-promotion.test.mjs
// (releaseWriterLease + replay reopen), and test/scratchpad-33-red.test.mjs (the
// scanForScratchpadWrite scanner discipline BW-24 mirrors — claude-session.mjs is imported as
// a namespace so a missing scanner export fails BW-24's own named stage instead of killing
// the whole file at load).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationRefusal, CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { createDriver } from '../src/index.mjs';
import { BatonApplication, projectBoardView } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import * as session from '../src/claude-session.mjs';

const REPO = 'repo-bw';
const NOW_MS = Date.parse('2026-08-03T00:00:00.000Z');
const RUN_LINEAGE_POLICY = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
  leaseTtlMs: 3_600_000, maxReplManifestsPerRun: 4,
});

const dirs = [];
function tmpDir(prefix = 'baton-bw-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
const drivers = [];
test.after(async () => {
  for (const driver of drivers) {
    try { await driver?.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver?.closeAuthority?.(); } catch { /* best effort */ }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function makeBrief(overrides = {}) {
  return {
    goal: 'work the shared board', constraints: [], pathScope: ['.'],
    definitionOfDone: 'reports filed', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

// Lightweight Coordinator fixture (bd3 pattern) — the authenticated per-worker event stream
// without the driver's git/worktree weight.
function workerFixture() {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  });
  return { dir, log, adapter, coordinator, coordination: coordinator._coordination, fences: coordinator._fences };
}

// Full application fixture (atlas/bidirectional-driver pattern, trimmed): a real createDriver
// stack so the S-2 run-orchestrator lease, the board→Run binding, and the waves.send direct
// port all share one durable store. Members are spawned through the coordinator and bound to
// the wave through the SAME steering.registered record shape application.start writes
// (application.mjs:4401-4409, code-verified).
async function waveFixture() {
  const repo = tmpDir('baton-bw-repo-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const adapter = new ScriptableAdapter();
  // The application profile-route reconciliation reads the adapter card's modelSelection
  // (atlas-orientation-red pattern): advertise the exact mock route the profile names.
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const logDir = tmpDir('baton-bw-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: RUN_LINEAGE_POLICY,
    now: () => NOW_MS,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 0 },
  });
  drivers.push(driver);
  const principalOf = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'], effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    principals: {
      planner: principalOf('bw-planner'),
      dispatcher: principalOf('bw-dispatcher'),
      observer: principalOf('bw-observer'),
    },
    authorize: async () => true,
  });
  const coordination = driver.coordination;
  const orch = authorityOn(coordination, { runId: 'run:coord', principalId: 'orchestrator', sessionId: 'session-orch' });
  const waveId = `wave:${digest('bw-wave').slice(0, 32)}`;
  return { repo, logDir, adapter, driver, application, coordination, orch, waveId, principalOf };
}

// S-2 authority fixture (board-authority-red pattern): an orchestrator task on `runId`, a
// claimed worker, and an issued run-orchestrator lease; returns the closed sessionAuthority
// proof the S-2 envelope consumes.
function authorityOn(coordination, { runId, principalId, sessionId }) {
  const authorityDigest = digest({ proof: `${runId}:${principalId}:${sessionId}` });
  const expiresAt = new Date(NOW_MS + 3_600_000).toISOString();
  const taskId = `task-${runId}-${principalId}`.replaceAll(':', '-');
  const workerId = `worker-${runId}-${principalId}`.replaceAll(':', '-');
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
      modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
      effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
      routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
    }).task;
  const identity = {
    repoId: coordination._repoId ?? REPO, parentRunId: runId, parentTaskId: taskId,
    parentTaskVersion: task.version, workerId, principalId, sessionId,
    sessionAuthorityDigest: authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: coordination._repoId ?? REPO, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest, expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const sessionAuthority = Object.freeze({
    schemaVersion: 1, authorityDigest, expiresAt, orchestratorLeaseId: receipt.lease.leaseId,
  });
  return { receipt, runId, principalId, sessionId, sessionAuthority, taskId, workerId };
}

// A wave member: a coordinator-spawned worker plus the byte-exact steering.registered record
// application.start writes for wave members (93B; application.mjs:4401-4409).
async function spawnMember(fx, { runId, role }) {
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId });
  fx.coordination.recordDriver('steering.registered', {
    runId, driverKind: 'wave', actor: fx.orch.principalId, waveId: fx.waveId, waveRole: role,
  }, { actor: fx.orch.principalId, key: `run.steering_registered:${runId}` });
  return handle;
}

function bindWaveRun(fx, runId, role) {
  fx.coordination.recordDriver('steering.registered', {
    runId, driverKind: 'wave', actor: fx.orch.principalId, waveId: fx.waveId, waveRole: role,
  }, { actor: fx.orch.principalId, key: `run.steering_registered:${runId}` });
}

// An orchestrator board post through the real S-2 admission seam (also creates/keeps the
// board→Run binding the grant's boardRunId must equal, Decision 3 step 4). `evidence` rides
// the post mutation's bounded ref list (≤8 refs; artifactId strings are length-unbounded,
// which is how BW-15 builds a legitimately oversize item row).
function s2Post(fx, { board, title, runId = 'run:coord', detail = null, owner = null, evidence = [] }) {
  return fx.coordination.admitBoardCommand({
    sessionAuthority: fx.orch.sessionAuthority, runId, board, item: null,
    mutation: { kind: 'post', title, detail, owner, evidence },
    expectedBoardFence: fx.coordination.boardFence(board),
    idempotencyKey: `bw:post:${board}:${title}`,
  });
}

// The waves.send claim-grant call (Decision 2). Today the closed wave-member normalizer
// refuses the claimGrant key with application_wave_member_action_invalid — that refusal IS
// the named red stage for every grant-dependent row.
async function sendGrant(fx, { runId, board, boardRunId = 'run:coord', idem, message = 'work the shared board', sessionAuthority }) {
  const sent = await fx.application.command('waves.send',
    { runId, message, claimGrant: { boardRunId, board } },
    { actor: `direct:${fx.orch.principalId}`, principalId: fx.orch.principalId, sessionId: fx.orch.sessionId },
    {
      transport: 'direct', requestId: `${idem}:req`, idempotencyKey: idem,
      sessionAuthority: sessionAuthority ?? fx.orch.sessionAuthority,
    }).then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown', error }));
  assert.ok(sent.ok,
    `stage[waves.send claim-grant transport missing]: waves.send must accept the closed `
    + `claimGrant {boardRunId, board} request (Decision 2); today it refuses with ${sent.code}`);
  return sent.receipt;
}

// The durable grant mint record (Decision 2's closed grant shape rides one new mint event;
// board.grant_revoked is contract-named and the mint kind is its parallel).
function mintedGrant(fx, { board, memberRunId }) {
  const events = fx.coordination.events().filter((event) => typeof event.kind === 'string'
    && event.kind.startsWith('board.grant_') && !event.kind.endsWith('_revoked')
    && event.payload?.board === board
    && (memberRunId === undefined || event.payload?.memberRunId === memberRunId));
  assert.equal(events.length, 1,
    'stage[grant mint missing]: exactly one durable grant mint event for (board, memberRunId) (Decision 2)');
  return events[0].payload;
}

// Worker-stream frames, mirroring the landed SCRATCHPAD_WRITE/CONTEXT_READ emission pattern:
// the adapter injects the parsed frame kind on the authenticated per-worker stream; the hub
// side owes the closed re-validation and the typed result.
function emitBoardClaim(adapter, handle, payload) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'board.claim', actor: 'worker', payload,
  });
}
function emitBoardReport(adapter, handle, payload) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'board.report', actor: 'worker', payload,
  });
}
function emitContextRead(adapter, handle, query, key) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query, expectedFence: 'current', idempotencyKey: key },
  });
}

function streamEvents(fx, handle, kind) {
  return fx.driver.coordinator._log.read(handle.id).filter((event) => event.kind === kind);
}
function claimResults(fx, handle) { return streamEvents(fx, handle, 'board.claim_result'); }
function reportResults(fx, handle) { return streamEvents(fx, handle, 'board.report_result'); }
function readResults(fx, handle) { return streamEvents(fx, handle, 'context.read_result'); }

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// A parked ScriptableAdapter worker takes the 'forced' kill path; a busy one confirms. Both
// are honest terminal transitions — the load-bearing assertions are the durable effects.
async function killMember(fx, workerId) {
  const killed = await fx.driver.coordinator.kill(workerId, 'human');
  assert.ok(['confirmed', 'forced'].includes(killed.result), `the member stop lands (got ${killed.result})`);
  return killed;
}

function freshStore() {
  return new CoordinationStore(tmpDir(), {
    repoId: REPO, clock: () => new Date(NOW_MS).toISOString(), runLineagePolicy: RUN_LINEAGE_POLICY,
  });
}

const text = (payload) => JSON.stringify(payload ?? {});

// ===========================================================================
// BW-01 — registry rows (stage: worker-profile rows are ghosts — surfaces: [],
// no authority/idempotency fields, liveMethod defaults to the key).
// ===========================================================================

test('BW-01 registry[ghost-rows]: board.claim/board.report stay worker-profile, gain the worker lane + live dispatch, and never list on ordinary surfaces', () => {
  const ops = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations;
  const claim = ops.find((op) => op.key === 'board.claim');
  const report = ops.find((op) => op.key === 'board.report');
  assert.ok(claim && report, 'both worker rows exist in the canonical registry');
  // Pin halves (green today and must stay green — the contract non-goal: no ordinary operator
  // impersonation; ordinary MCP/Web/CLI keeps the worker-profile rows absent).
  assert.equal(claim.profile, 'worker');
  assert.equal(report.profile, 'worker');
  for (const op of [claim, report]) {
    for (const surface of ['mcp', 'web', 'cli']) {
      assert.equal(op.surfaces.includes(surface), false,
        `${op.key} never lists on the ordinary ${surface} inventory`);
    }
  }
  // Red halves (Decision 1): the rows gain the embedded worker surface and a live dispatch
  // through the worker admission seam — today surfaces is [] and liveMethod defaults to the key.
  assert.ok(claim.surfaces.includes('embedded'),
    'stage[registry ghost]: board.claim gains the embedded authenticated worker lane (Decision 1)');
  assert.ok(report.surfaces.includes('embedded'),
    'stage[registry ghost]: board.report gains the embedded authenticated worker lane (Decision 1)');
  assert.notEqual(claim.liveMethod, 'board.claim',
    'stage[registry ghost]: board.claim names a live worker-seam dispatch instead of the default key');
  assert.notEqual(report.liveMethod, 'board.report',
    'stage[registry ghost]: board.report names a live worker-seam dispatch instead of the default key');
  // Decision 1/4 wire fields on the transported schemas: grantId + idempotencyKey on both rows,
  // expectedClaimVersion on the canonical report schema.
  for (const field of ['grantId', 'idempotencyKey']) {
    assert.ok(Object.hasOwn(claim.inputSchema.properties, field),
      `stage[registry ghost]: the board.claim schema carries ${field} (Decision 1 frame shape)`);
    assert.ok(Object.hasOwn(report.inputSchema.properties, field),
      `stage[registry ghost]: the board.report schema carries ${field} (Decision 1 frame shape)`);
  }
  assert.ok(Object.hasOwn(report.inputSchema.properties, 'expectedClaimVersion'),
    'stage[registry ghost]: the canonical report schema gains expectedClaimVersion (Decision 4)');
});

// ===========================================================================
// BW-02 — worker stream dispatch (stage: no board.claim/board.report case on the
// authenticated worker event switch; no typed result receipts exist).
// ===========================================================================

test('BW-02 lane[stream-dispatch-missing]: BOARD_CLAIM/BOARD_REPORT frames produce typed results; identity-smuggling frames refuse closed', async () => {
  const { adapter, coordinator, coordination } = workerFixture();
  const handle = await coordinator.spawn('mock', makeBrief());
  const posted = coordination.postBoardItem({ board: 'shared', title: 'triage me' }, { actor: 'fixture', key: 'bw02:post' });
  const itemId = posted.item.itemId;
  // A syntactically valid claim frame with no live grant behind it: the admission seam owes the
  // constant pre-existence refusal as a typed board.claim_result on the SAME worker stream.
  emitBoardClaim(adapter, handle, {
    grantId: 'grant:bw02-nonexistent', itemId, expectedBoardFence: 1, idempotencyKey: 'bw02-claim-1',
  });
  emitBoardReport(adapter, handle, {
    grantId: 'grant:bw02-nonexistent', itemId, itemVersion: 1, itemDigest: posted.item.itemDigest,
    expectedClaimVersion: 1, body: 'report without any grant', idempotencyKey: 'bw02-report-1',
  });
  // A frame carrying caller-named identity/scope fields is rejected closed — it must never
  // reach a state lookup, and its receipt is a typed invalid refusal, never a claim.
  emitBoardClaim(adapter, handle, {
    grantId: 'grant:bw02-nonexistent', itemId, expectedBoardFence: 1, idempotencyKey: 'bw02-claim-2',
    workerId: 'w-mallory',
  });
  await flush();
  const claims = claimResults({ driver: { coordinator } }, handle);
  const reports = reportResults({ driver: { coordinator } }, handle);
  // The well-formed attempts are always receipted (Decision 1: "every attempt produces a
  // result, including typed refusals"). The scanner-dropped smuggle frame may yield NO
  // receipt (rejected before it becomes an attempt) or an invalid one (coordinator-level
  // closed re-validation, the bd3 A1b discipline) — both are honest; what matters is that it
  // is never admitted and never lands a claim event.
  const noGrant = claims.filter((event) => text(event.payload).includes('bw02-claim-1'));
  assert.equal(noGrant.length, 1,
    'stage[worker stream dispatch missing]: every BOARD_CLAIM attempt produces a board.claim_result '
    + 'on the same worker stream, including typed refusals (Decision 1); today no such receipt exists');
  assert.ok(text(noGrant[0].payload).includes('board_worker_scope_refused'),
    'an absent grant receives the constant board_worker_scope_refused before any item lookup (Decision 3)');
  assert.equal(reports.length, 1,
    'stage[worker stream dispatch missing]: every BOARD_REPORT attempt produces a board.report_result (Decision 1)');
  assert.ok(text(reports[0].payload).includes('board_worker_scope_refused'),
    'a report without a grant receives the same constant pre-existence refusal (Decision 3)');
  const smuggled = claims.filter((event) => text(event.payload).includes('bw02-claim-2'));
  for (const receipt of smuggled) {
    assert.match(text(receipt.payload), /invalid/,
      'a caller-named workerId field is rejected by the closed frame discipline (Decision 1)');
  }
  assert.equal(coordination.events().filter((event) => event.kind === 'board.claim_requested').length, 0,
    'no claim event ever lands from these frames — the identity-smuggling frame is never admitted');
});

// ===========================================================================
// BW-03 — waves.send mints the grant (stage: the closed wave-member normalizer
// refuses claimGrant today; no grant machinery exists). Folds BW-21: the minted
// grant's closed key set admits no TTL/expiry/deadline field.
// ===========================================================================

test('BW-03 waves.send[claim-grant-missing]: claimGrant mints one closed server-side grant; the delivered worker fact carries no S-2 material', async () => {
  // Registry half: the detached ordinary waves.send row gains the optional closed claimGrant.
  const wavesSend = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((op) => op.key === 'waves.send');
  assert.ok(wavesSend, 'the waves.send registry row exists');
  const claimGrant = wavesSend.inputSchema.properties.claimGrant;
  assert.ok(claimGrant,
    'stage[waves.send claim-grant transport missing]: the waves.send schema gains the optional closed claimGrant (Decision 2)');
  assert.equal(wavesSend.inputSchema.required.includes('claimGrant'), false, 'claimGrant is optional');
  assert.deepEqual(Object.keys(claimGrant.properties ?? {}).sort(), ['board', 'boardRunId'],
    'the claimGrant request is exactly {boardRunId, board} — the caller names no grantee and no permissions');
  assert.equal(claimGrant.additionalProperties, false, 'the claimGrant request is closed');

  // Behavioral half.
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  s2Post(fx, { board: 'wave-board', title: 'item one' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw03:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  // The closed grant shape (Decision 2; BW-21: no TTL/expiry/deadline field can exist here).
  assert.deepEqual(Object.keys(grant).sort(), [
    'board', 'boardRunId', 'grantDigest', 'grantId', 'memberRunId', 'mintedEvent', 'permissions',
    'processGeneration', 'schemaVersion', 'state', 'taskId', 'taskVersion', 'waveId', 'workerId',
  ].sort(),
  'the minted grant is the closed Decision-2 shape — no clock/turn/TTL field exists to add (BW-21)');
  assert.equal(grant.schemaVersion, 1);
  assert.equal(grant.state, 'active');
  assert.equal(grant.board, 'wave-board');
  assert.equal(grant.boardRunId, 'run:coord', 'the grant binds the board\u2019s recorded binding Run');
  assert.equal(grant.memberRunId, 'run:member-a');
  assert.equal(grant.waveId, fx.waveId);
  assert.equal(grant.workerId, member.id, 'the grant binds the stream-derived worker, never a caller-named grantee');
  assert.ok(Array.isArray(grant.permissions) && grant.permissions.length >= 1
    && grant.permissions.every((perm) => ['read', 'claim', 'report'].includes(perm)),
  'permissions are a server-recorded subset of read|claim|report (Decision 2)');
  // The worker receives a hub-computed fact adjacent to the framed steer body — and the steer
  // never contains sessionAuthority, its digest, its lease id, its expiry, or reusable authority.
  const delivered = fx.adapter.calls.prompt.map((call) => text(call.content)).join('\n');
  assert.ok(delivered.includes(grant.grantId), 'the grant id reaches the worker as a hub-computed fact');
  for (const leaked of [
    fx.orch.sessionAuthority.authorityDigest,
    fx.orch.sessionAuthority.orchestratorLeaseId,
    fx.orch.sessionAuthority.expiresAt,
    'sessionAuthority',
  ]) {
    assert.equal(delivered.includes(leaked), false,
      `the delivered worker fact never carries S-2 lease material (${leaked.slice(0, 24)}…) (BW-03)`);
  }
});

// ===========================================================================
// BW-04 — grant-scoped admission (stage: no worker admission seam exists; the
// direct store methods confer no transported authority).
// ===========================================================================

test('BW-04 scope[admission-seam-missing]: absent/foreign/cross-board grants refuse board_worker_scope_refused before item lookup; a same-wave grant claims', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'claimable' });
  const foreignAuth = authorityOn(fx.coordination, { runId: 'run:foreign', principalId: 'orch-two', sessionId: 'session-two' });
  const foreignPosted = fx.coordination.admitBoardCommand({
    sessionAuthority: foreignAuth.sessionAuthority, runId: 'run:foreign', board: 'foreign-board', item: null,
    mutation: { kind: 'post', title: 'not your board', detail: null, owner: null, evidence: [] },
    expectedBoardFence: 0, idempotencyKey: 'bw04:foreign:post',
  });
  const memberA = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  const memberB = await spawnMember(fx, { runId: 'run:member-b', role: 'exec-b' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw04:send:a' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const fence = fx.coordination.boardFence('wave-board');

  // (a) A fabricated grant id — constant refusal before item lookup.
  emitBoardClaim(fx.adapter, memberA, {
    grantId: 'grant:bw04-fabricated', itemId: posted.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw04:c1',
  });
  // (b) A's real grant against an item on a foreign board — same constant refusal.
  emitBoardClaim(fx.adapter, memberA, {
    grantId: grant.grantId, itemId: foreignPosted.item.itemId, expectedBoardFence: 1, idempotencyKey: 'bw04:c2',
  });
  // (c) A fabricated grant against a NONEXISTENT item — scope refusal, never board_item_not_found.
  emitBoardClaim(fx.adapter, memberA, {
    grantId: 'grant:bw04-fabricated', itemId: 'board-item:bw04-absent', expectedBoardFence: fence, idempotencyKey: 'bw04:c3',
  });
  // (d) Member B holds no grant at all — same constant refusal.
  emitBoardClaim(fx.adapter, memberB, {
    grantId: grant.grantId, itemId: posted.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw04:c4',
  });
  // (e) The positive: A claims the granted board's item at the current fence — the
  // server-proven same-wave board Run/member Run relaxation succeeds (Decision 2).
  emitBoardClaim(fx.adapter, memberA, {
    grantId: grant.grantId, itemId: posted.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw04:c5',
  });
  await flush(60);
  const results = claimResults(fx, memberA);
  assert.equal(results.length, 4, 'each of A\u2019s four attempts produces a typed board.claim_result');
  const byKey = (key) => results.find((event) => text(event.payload).includes(key));
  for (const [key, label] of [['bw04:c1', 'fabricated grant'], ['bw04:c2', 'cross-board item'], ['bw04:c3', 'nonexistent item']]) {
    assert.ok(byKey(key), `${label}: receipt exists`);
    assert.ok(text(byKey(key).payload).includes('board_worker_scope_refused'),
      `${label}: the constant board_worker_scope_refused — no existence leak, refusal precedes item lookup (Decision 3)`);
    assert.equal(text(byKey(key).payload).includes('board_item_not_found'), false,
      `${label}: the pre-existence refusal never reveals item existence`);
  }
  const bResults = claimResults(fx, memberB);
  assert.equal(bResults.length, 1, 'B\u2019s attempt is receipted too');
  assert.ok(text(bResults[0].payload).includes('board_worker_scope_refused'),
    'a foreign worker holding only the grant id string receives the same constant refusal (possession ≠ authority)');
  const c5 = byKey('bw04:c5');
  assert.ok(c5, 'the valid same-wave claim has its receipt');
  assert.ok(text(c5.payload).includes('"ok":true')
    || fx.coordination.activeBoardClaims({ workerId: memberA.id }).length === 1,
  'the valid same-wave grant claims the item (the positive control)');
  const claimEvent = fx.coordination.events().find((event) => event.kind === 'board.claim_requested'
    && event.payload?.itemId === posted.item.itemId);
  assert.ok(claimEvent, 'the winning claim is durable');
  assert.equal(claimEvent.payload?.owner, memberA.id,
    'the durable claim\u2019s actor coordinates are the stream-derived worker principal, never caller-named (Decision 1)');
});

// ===========================================================================
// BW-05 — grant retry dedup (stage: no grant mint, no effective replay key
// <opKind>:<grantDigest>:<callerKey> for grant.mint).
// ===========================================================================

test('BW-05 waves.send[retry-dedup-missing]: an exact claimGrant retry returns one grant and one steer; changed content conflicts', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  s2Post(fx, { board: 'wave-board', title: 'dedup target' });
  s2Post(fx, { board: 'other-board', title: 'changed content target' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  const first = await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw05:send:1' });
  // The exact authorized retry: same member, same board, same idempotency key.
  const second = await fx.application.command('waves.send',
    { runId: 'run:member-a', message: 'work the shared board', claimGrant: { boardRunId: 'run:coord', board: 'wave-board' } },
    { actor: `direct:${fx.orch.principalId}`, principalId: fx.orch.principalId, sessionId: fx.orch.sessionId },
    { transport: 'direct', requestId: 'bw05:send:1:req', idempotencyKey: 'bw05:send:1', sessionAuthority: fx.orch.sessionAuthority });
  const mintEvents = fx.coordination.events().filter((event) => typeof event.kind === 'string'
    && event.kind.startsWith('board.grant_') && !event.kind.endsWith('_revoked'));
  assert.equal(mintEvents.length, 1, 'an exact retry appends no duplicate grant event (Decision 6 rule 2)');
  const firstGrant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  assert.ok(text(second).includes(firstGrant.grantId), 'the retry returns the ORIGINAL grant receipt');
  assert.equal(text(first).includes(firstGrant.grantId), true, 'the first receipt names the same grant');
  const steers = fx.adapter.calls.prompt.filter((call) => call.worker === member.id);
  assert.equal(steers.length, 1, 'the steer is delivered exactly once across the retry');
  // Changed content under the same idempotency key conflicts — it never mints a second grant.
  const changed = await fx.application.command('waves.send',
    { runId: 'run:member-a', message: 'work the shared board', claimGrant: { boardRunId: 'run:coord', board: 'other-board' } },
    { actor: `direct:${fx.orch.principalId}`, principalId: fx.orch.principalId, sessionId: fx.orch.sessionId },
    { transport: 'direct', requestId: 'bw05:send:2:req', idempotencyKey: 'bw05:send:1', sessionAuthority: fx.orch.sessionAuthority })
    .then((receipt) => text(receipt), (error) => String(error?.code ?? error));
  assert.match(String(changed), /conflict/,
    'changed board content under one effective key refuses as a conflict (Decision 6 rule 3)');
  assert.equal(fx.coordination.events().filter((event) => typeof event.kind === 'string'
    && event.kind.startsWith('board.grant_') && !event.kind.endsWith('_revoked')).length, 1,
  'the conflicting retry minted nothing');
});

// ===========================================================================
// BW-06 — claim in-append CAS (stage: the worker claim path has no before-write
// gate; requestBoardClaim checks the fence once and appends).
// ===========================================================================

test('BW-06 cas[in-append-gate-missing]: an interleaved orchestrator mutation refuses the worker claim stale_board_fence and lands no claim event', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'raced item' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw06:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const fence = fx.coordination.boardFence('wave-board');
  // The store's shared before-write instrumentation hook (the same one the S-2 append gate
  // consults): an orchestrator mutation injected inside the append window advances boardFence
  // after the claim's preview check. The seam's final CAS must lose — loudly.
  let interleaved = false;
  fx.coordination._boardAdmissionInterleave = () => {
    if (interleaved) return;
    interleaved = true;
    fx.coordination.postBoardItem({ board: 'wave-board', title: 'racing orchestrator post' }, { actor: 'fixture', key: 'bw06:race' });
  };
  emitBoardClaim(fx.adapter, member, {
    grantId: grant.grantId, itemId: posted.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw06:c1',
  });
  await flush(60);
  assert.equal(interleaved, true, 'the in-append interleave actually fired inside the append window');
  const results = claimResults(fx, member);
  assert.equal(results.length, 1, 'the raced claim produces its typed result');
  assert.ok(text(results[0].payload).includes('stale_board_fence'),
    'the in-append fence re-check refuses stale_board_fence (Decision 3 step 7; BW-06 oracle)');
  assert.equal(fx.coordination.events().filter((event) => event.kind === 'board.claim_requested'
    && event.payload?.itemId === posted.item.itemId).length, 0,
  'no claim event lands from the lost race');
});

// ===========================================================================
// BW-07 — fence law PIN (green today; Decision 4 normative law + ground truth
// 6/7: claim/report/migration/expiry never bump boardFence; the projection
// freshness component counts claim/report/expiry; turn fences are never claim CAS).
// ===========================================================================

test('BW-07 fences[pin]: claim/report/expiry never bump boardFence while projectionInputFence advances; turn fences never touch claim CAS', async () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'A' }, { actor: 'fixture', key: 'bw07:post' });
  assert.equal(s.boardFence('shared'), 1);
  const p0 = s.projectionInputFence();
  const claim = s.requestBoardClaim({ itemId: posted.item.itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: 'bw07:claim' });
  assert.equal(claim.result, 'claimed');
  assert.equal(s.boardFence('shared'), 1, 'claim_requested never bumps the board fence');
  assert.equal(s.projectionInputFence(), p0 + 1, 'claim_requested advances the projection freshness component');
  s.submitBoardReport({
    itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest, owner: 'w1', body: 'note',
  }, { actor: 'worker', key: 'bw07:report' });
  assert.equal(s.boardFence('shared'), 1, 'report_submitted never bumps the board fence');
  assert.equal(s.projectionInputFence(), p0 + 2, 'report_submitted advances the freshness component');
  s.expireBoardClaim(posted.item.itemId, 1, { actor: 'policy', key: 'bw07:expire' });
  assert.equal(s.boardFence('shared'), 1, 'claim_expired never bumps the board fence');
  assert.equal(s.projectionInputFence(), p0 + 3, 'claim_expired advances the freshness component');

  // Turn/session fence half: the worker turn fence is never claim authority (the claimScratch trap).
  const { coordinator, coordination, fences } = workerFixture();
  const handle = await coordinator.spawn('mock', makeBrief());
  const posted2 = coordination.postBoardItem({ board: 'shared', title: 'B', owner: handle.id }, { actor: 'fixture', key: 'bw07:post2' });
  const claim2 = coordinator.requestBoardClaim(handle.id, { itemId: posted2.item.itemId, expectedBoardFence: 1 }, { idempotencyKey: 'bw07:claim2' });
  assert.equal(claim2.result, 'claimed');
  fences.bumpTurn(handle.id);
  fences.bumpHuman(handle.id);
  assert.equal(coordination.activeBoardClaims({ workerId: handle.id }).length, 1,
    'the board claim is untouched by worker turn/human fence bumps');
  assert.equal(coordinator.boardFence('shared'), 1, 'the board fence is unmoved by worker fence changes');
});

// ===========================================================================
// BW-08 — report CAS set (stage: the admission seam is missing; the kernel
// submitBoardReport requires no active claim, no owner, no claim version, and
// accepts terminal items — and the contract assigns those checks to the seam).
// ===========================================================================

test('BW-08 report-cas[admission-seam-missing]: reports require an active owned claim, the exact claim version, and an open item', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const first = s2Post(fx, { board: 'wave-board', title: 'report target one' });
  const second = s2Post(fx, { board: 'wave-board', title: 'report target two' });
  const memberA = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  const memberB = await spawnMember(fx, { runId: 'run:member-b', role: 'exec-b' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw08:send:a' });
  await sendGrant(fx, { runId: 'run:member-b', board: 'wave-board', idem: 'bw08:send:b' });
  const grantA = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const grantB = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-b' });
  const fence = fx.coordination.boardFence('wave-board');

  // (a) Report with NO active claim at all (exact historical binding, well-formed otherwise).
  emitBoardReport(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: first.item.itemId, itemVersion: 1, itemDigest: first.item.itemDigest,
    expectedClaimVersion: 1, body: 'report with no claim', idempotencyKey: 'bw08:r1',
  });
  await flush(60);
  let results = reportResults(fx, memberA);
  assert.equal(results.length, 1, 'the claim-less report is receipted');
  assert.ok(!text(results[0].payload).includes('"ok":true')
    && fx.coordination.events().every((event) => event.kind !== 'board.report_submitted'),
  'a report without an active owned claim refuses and lands nothing (Decision 4; the kernel allows it today)');

  // (b) A claims; B reports against A's claim (foreign owner, same board, valid grant of its own).
  emitBoardClaim(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: first.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw08:c1',
  });
  await flush(60);
  assert.equal(fx.coordination.activeBoardClaims({ workerId: memberA.id }).length, 1, 'A holds the active claim');
  emitBoardReport(fx.adapter, memberB, {
    grantId: grantB.grantId, itemId: first.item.itemId, itemVersion: 1, itemDigest: first.item.itemDigest,
    expectedClaimVersion: 1, body: 'report against another worker\u2019s claim', idempotencyKey: 'bw08:r2',
  });
  // (c) A reports with the wrong claim version (the concurrent-close guard).
  emitBoardReport(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: first.item.itemId, itemVersion: 1, itemDigest: first.item.itemDigest,
    expectedClaimVersion: 99, body: 'wrong claim version', idempotencyKey: 'bw08:r3',
  });
  await flush(60);
  assert.equal(fx.coordination.events().filter((event) => event.kind === 'board.report_submitted').length, 0,
    'foreign-owner and wrong-version reports land nothing');
  results = reportResults(fx, memberB);
  assert.equal(results.length, 1, 'B\u2019s foreign-claim report is receipted');
  assert.ok(!text(results[0].payload).includes('"ok":true'), 'a report against another worker\u2019s claim refuses');
  results = reportResults(fx, memberA);
  assert.equal(results.length, 2, 'A\u2019s wrong-version report is receipted');
  assert.ok(!text(results[1].payload).includes('"ok":true'), 'a stale claim version refuses the report');

  // (d) A reports the exact owned claim version — the positive control.
  emitBoardReport(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: first.item.itemId, itemVersion: 1, itemDigest: first.item.itemDigest,
    expectedClaimVersion: 1, body: 'owned claim, exact version', idempotencyKey: 'bw08:r4',
  });
  await flush(60);
  const reports = fx.coordination.events().filter((event) => event.kind === 'board.report_submitted');
  assert.equal(reports.length, 1, 'the valid owner/task/grant plus exact claim version succeeds (BW-08 oracle)');
  assert.equal(reports[0].payload?.owner, memberA.id, 'the durable report is worker-attributed');

  // (e) Terminal item: the orchestrator S-2 closes the second item (which also expires any
  // claim on it, BW-18a) — a report against it now refuses even with an otherwise valid grant.
  emitBoardClaim(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: second.item.itemId, expectedBoardFence: fx.coordination.boardFence('wave-board'),
    idempotencyKey: 'bw08:c2',
  });
  await flush(60);
  fx.coordination.admitBoardCommand({
    sessionAuthority: fx.orch.sessionAuthority, runId: 'run:coord', board: 'wave-board',
    item: { itemId: second.item.itemId, itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw08:close:2',
  });
  emitBoardReport(fx.adapter, memberA, {
    grantId: grantA.grantId, itemId: second.item.itemId, itemVersion: 1, itemDigest: second.item.itemDigest,
    expectedClaimVersion: 1, body: 'report against a closed item', idempotencyKey: 'bw08:r5',
  });
  await flush(60);
  assert.equal(fx.coordination.events().filter((event) => event.kind === 'board.report_submitted'
    && event.payload?.itemId === second.item.itemId).length, 0,
  'a terminal item stops accepting evidence (Decision 8: report admission requires state open)');
});

// ===========================================================================
// BW-09 — migration PIN (green today; Decision 4 Migration: retitle/reorder
// continues to migrate the active claim; the report binds the exact observed
// version/digest, never the successor by implication).
// ===========================================================================

test('BW-09 migration[pin]: a benign retitle migrates the active claim; a report binds the exact observed version/digest, never the successor', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'Do X', owner: 'w1' }, { actor: 'fixture', key: 'bw09:post' });
  const itemId = posted.item.itemId;
  const observedDigest = posted.item.itemDigest;
  const claim = s.requestBoardClaim({ itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: 'bw09:claim' });
  assert.equal(claim.result, 'claimed');
  const retitled = s.retitleBoardItem(itemId, { title: 'Do X (edited)' }, { actor: 'fixture', key: 'bw09:retitle' });
  assert.equal(retitled.migrated, true, 'the held claim migrates across the benign edit');
  const carried = s.activeBoardClaims({ workerId: 'w1' });
  assert.equal(carried.length, 1);
  assert.equal(carried[0].itemId, itemId, 'the claim survives under the stable itemId');
  assert.equal(carried[0].version, 1, 'migration is not an expiry — the claim version does not bump');
  const report = s.submitBoardReport({
    itemId, itemVersion: 1, itemDigest: observedDigest, owner: 'w1', body: 'evidence against v1',
  }, { actor: 'worker', key: 'bw09:report' });
  assert.equal(report.result, 'submitted');
  assert.equal(report.report.itemVersion, 1, 'the report binds the exact older version the worker observed');
  assert.equal(report.report.itemDigest, observedDigest, 'the envelope never re-points the evidence to the successor');
  assert.throws(() => s.submitBoardReport({
    itemId, itemVersion: 1, itemDigest: retitled.item.itemDigest, owner: 'w1', body: 'successor digest on the old version',
  }, { actor: 'worker', key: 'bw09:report:bad' }),
  (error) => error instanceof CoordinationRefusal && error.code === 'board_report_binding_mismatch');
});

// ===========================================================================
// BW-10 — evidence-not-completion PIN (green today; Decision 4 Completion +
// non-goal: no automatic item close from a report).
// ===========================================================================

test('BW-10 evidence[pin]: a report changes neither item nor claim state; only an S-2 successor command closes the item', () => {
  const s = freshStore();
  const orch = authorityOn(s, { runId: 'run:coord', principalId: 'orchestrator', sessionId: 'session-orch' });
  const posted = s.admitBoardCommand({
    sessionAuthority: orch.sessionAuthority, runId: 'run:coord', board: 'shared', item: null,
    mutation: { kind: 'post', title: 'evidence target', detail: null, owner: null, evidence: [] },
    expectedBoardFence: 0, idempotencyKey: 'bw10:post',
  });
  const itemId = posted.item.itemId;
  const claim = s.requestBoardClaim({ itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: 'bw10:claim' });
  assert.equal(claim.result, 'claimed');
  s.submitBoardReport({
    itemId, itemVersion: 1, itemDigest: posted.item.itemDigest, owner: 'w1', body: 'done-ish, but only evidence',
  }, { actor: 'worker', key: 'bw10:report' });
  assert.equal(s.boardItem(itemId).state, 'open', 'the report leaves the item state unchanged');
  assert.equal(s.activeBoardClaims({ workerId: 'w1' }).length, 1, 'the report leaves the claim active');
  assert.equal(s.boardFence('shared'), 1, 'the report moves no fence');
  const closed = s.admitBoardCommand({
    sessionAuthority: orch.sessionAuthority, runId: 'run:coord', board: 'shared',
    item: { itemId, itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: 1, idempotencyKey: 'bw10:close',
  });
  assert.equal(closed.ok, true, 'only the authorized S-2 successor command closes the item');
  assert.equal(s.boardItem(itemId).state, 'closed');
});

// ===========================================================================
// BW-11 — kernel replay adjudication (stage: blind _byKey return — all three
// kernel methods return any prior event under the key before comparing content).
// ===========================================================================

test('BW-11 replay[blind-bykey]: kernel claim/report/expire digest-adjudicate — changed content under one key refuses board_replay_conflict; exact retries replay', () => {
  const s = freshStore();
  const a = s.postBoardItem({ board: 'shared', title: 'A' }, { actor: 'fixture', key: 'bw11:post:a' });
  const b = s.postBoardItem({ board: 'shared', title: 'B' }, { actor: 'fixture', key: 'bw11:post:b' });

  // (a) Same claim key, changed item content.
  const first = s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 2 }, { actor: 'worker', key: 'bw11:claim' });
  assert.equal(first.result, 'claimed');
  assert.throws(() => s.requestBoardClaim({ itemId: b.item.itemId, owner: 'w1', expectedBoardFence: 2 }, { actor: 'worker', key: 'bw11:claim' }),
    (error) => error instanceof CoordinationRefusal && error.code === 'board_replay_conflict',
  'stage[blind _byKey]: changed claim content under one key refuses board_replay_conflict (Decision 6 rule 3); '
  + 'today the kernel returns the old success');
  // (b) Same report key, changed body.
  s.submitBoardReport({
    itemId: a.item.itemId, itemVersion: 1, itemDigest: a.item.itemDigest, owner: 'w1', body: 'body one',
  }, { actor: 'worker', key: 'bw11:report' });
  assert.throws(() => s.submitBoardReport({
    itemId: a.item.itemId, itemVersion: 1, itemDigest: a.item.itemDigest, owner: 'w1', body: 'body two — changed under one key',
  }, { actor: 'worker', key: 'bw11:report' }),
  (error) => error instanceof CoordinationRefusal && error.code === 'board_replay_conflict',
  'stage[blind _byKey]: changed report content under one key refuses board_replay_conflict');
  // (c) Cross-operation key-string collision: a report reusing the claim's key must be
  // adjudicated on its own content — never swallowed as the claim's idempotent replay.
  assert.throws(() => s.submitBoardReport({
    itemId: a.item.itemId, itemVersion: 1, itemDigest: a.item.itemDigest, owner: 'w1', body: 'riding the claim key',
  }, { actor: 'worker', key: 'bw11:claim' }),
  (error) => error instanceof CoordinationRefusal && error.code === 'board_replay_conflict',
  'stage[blind _byKey]: a cross-operation key collision refuses instead of returning the claim\u2019s event');
  // (d) Pin half (green today and on green — rule 2): the EXACT authorized retry replays.
  const retry = s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 2 }, { actor: 'worker', key: 'bw11:claim' });
  assert.equal(retry.result, 'idempotent');
  assert.equal(retry.event.seq, first.event.seq, 'an exact retry returns the original event');
  assert.equal(s.events().filter((event) => event.kind === 'board.claim_requested').length, 1,
    'an exact retry appends no duplicate event');
  // (e) Same expiry key, changed expected version.
  s.expireBoardClaim(a.item.itemId, 1, { actor: 'policy', key: 'bw11:expire' });
  assert.throws(() => s.expireBoardClaim(a.item.itemId, 2, { actor: 'policy', key: 'bw11:expire' }),
    (error) => error instanceof CoordinationRefusal && error.code === 'board_replay_conflict',
  'stage[blind _byKey]: changed expiry content under one key refuses board_replay_conflict, never a stale success');
});

// ===========================================================================
// BW-12 — restart replay (stage: no grant events exist to replay; the durable
// generation record does not exist either).
// ===========================================================================

test('BW-12 restart[grant-durability-missing]: replay reconstructs grants, claims, reports, and both fences byte-identically; a pre-restart respawn replays its generation record and the old grant stays unusable', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'replay target' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw12:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  emitBoardClaim(fx.adapter, member, {
    grantId: grant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw12:c1',
  });
  await flush(60);
  emitBoardReport(fx.adapter, member, {
    grantId: grant.grantId, itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest,
    expectedClaimVersion: 1, body: 'replayable evidence', idempotencyKey: 'bw12:r1',
  });
  await flush(60);
  await killMember(fx, member.id);
  // A2-3: respawn the SAME member Run BEFORE the restart. The replacement generation attaches
  // here, so its durable generation record must land in the frozen log — without it replay
  // cannot derive which grants the replacement generation invalidates.
  const member2 = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:member-a' });
  // Freeze the ledger before snapshotting: release the writer lease first so no trailing
  // lifecycle append can land between the live read and the reopen (the comparison below is
  // against the same frozen event set on both sides).
  fx.coordination.releaseWriterLease();
  const before = fx.coordination.events().map((event) => JSON.stringify(event));
  const fences = {
    boardFence: fx.coordination.boardFence('wave-board'),
    projectionInputFence: fx.coordination.projectionInputFence(),
  };
  const replay = new CoordinationStore(join(fx.logDir, 'coordination'));
  const after = replay.events().map((event) => JSON.stringify(event));
  assert.deepEqual(after, before, 'replay reconstructs every event byte-identically across store restart (Decision 6 rule 6)');
  assert.equal(replay.boardFence('wave-board'), fences.boardFence, 'boardFence replays exactly');
  assert.equal(replay.projectionInputFence(), fences.projectionInputFence, 'projectionInputFence replays exactly');
  assert.equal(replay.activeBoardClaims({ workerId: member.id }).length, 0,
    'the expired claim stays expired — replay cannot resurrect it (Decision 8)');
  const revoked = replay.events().filter((event) => event.kind === 'board.grant_revoked');
  assert.ok(revoked.length >= 1, 'the durable board.grant_revoked survives restart — replay derives revoked, never active');
  // The durable generation record (Decision 2; A2-3): the respawn's attachment is an event,
  // not only an in-memory worker-handle property, so replay derives the invalidation.
  const generationRecords = replay.events().filter((event) => typeof event.kind === 'string'
    && event.kind.startsWith('worker.generation_') && event.payload?.workerId === member2.id);
  assert.ok(generationRecords.length >= 1
    && generationRecords.every((event) => Number.isSafeInteger(event.payload?.processGeneration)),
    'stage[generation record missing]: the respawn appends a durable generation-record event carrying workerId and processGeneration (Decision 2; A2-3)');
  // The old grant is replay-derived unusable: the replacement generation's post-restart claim
  // attempt with it draws the constant scope refusal (Decisions 2/8).
  emitBoardClaim(fx.adapter, member2, {
    grantId: grant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: replay.boardFence('wave-board'), idempotencyKey: 'bw12:c2',
  });
  await flush(60);
  const staleAttempt = claimResults(fx, member2);
  assert.equal(staleAttempt.length, 1, 'the replacement generation\u2019s post-restart attempt is receipted');
  assert.ok(text(staleAttempt[0].payload).includes('board_worker_scope_refused'),
    'the old grant is replay-derived unusable — a replacement generation cannot resurrect it across restart (Decision 2/8; A2-3)');
});

// ===========================================================================
// BW-13 — grant-scoped worker read (stage: no L1 read lane; today's worker
// projection hides unowned open shared items).
// ===========================================================================

test('BW-13 read[l1-lane-missing]: a granted worker reads every item on the exact granted board — unowned open work included', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  s2Post(fx, { board: 'wave-board', title: 'unowned claimable work' });
  s2Post(fx, { board: 'wave-board', title: 'owned by another worker', owner: 'w:someone-else' });
  s2Post(fx, { board: 'wave-board', title: 'owned by the reader', owner: null });
  s2Post(fx, { board: 'second-board', title: 'a different board entirely' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw13:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null }, 'bw13:read:1');
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: 'grant:bw13-fabricated', cursor: null }, 'bw13:read:2');
  await flush(60);
  const results = readResults(fx, member);
  assert.equal(results.length, 2,
    'stage[L1 read lane missing]: the CONTEXT_READ board query is answered through the authenticated lane (Decision 5)');
  const page = results[0];
  assert.ok(text(page.payload).includes('"ok":true'), 'the valid grant read answers');
  for (const title of ['unowned claimable work', 'owned by another worker', 'owned by the reader']) {
    assert.ok(text(page.payload).includes(title),
      `the granted view contains "${title}" — including unowned open work (BW-13 oracle; today's projection hides it)`);
  }
  assert.equal(text(page.payload).includes('a different board entirely'), false,
    'the grant scopes exactly one board — no second board serves (Decision 5)');
  assert.ok(text(page.payload).includes('UNTRUSTED'),
    'every model-authored leaf crosses the one closed renderer, UNTRUSTED-framed (Decision 5)');
  assert.ok(text(results[1].payload).includes('board_worker_scope_refused'),
    'a fabricated grant id receives the constant scope refusal — nonexistent and unauthorized share it (Decision 5)');
});

// ===========================================================================
// BW-14 — view freshness (stage: boardSnapshot projects no projectionInputFence
// and projectBoardView's cache key is (board, role/workerId, boardFence) only —
// a pre-claim/pre-report view can be served forever).
// ===========================================================================

test('BW-14 freshness[cache-key-gap]: a claim/report moves the view freshness key without moving boardFence or claim CAS', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'freshness target', owner: 'w1' }, { actor: 'fixture', key: 'bw14:post' });
  const cache = new Map();
  const viewer = { role: 'orchestrator', workerId: null };
  const before = projectBoardView(s.boardSnapshot('shared'), viewer, cache);
  assert.equal(before.items[0].reports.length, 0, 'the first view has no reports');
  s.requestBoardClaim({ itemId: posted.item.itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: 'bw14:claim' });
  const snapshot2 = s.boardSnapshot('shared');
  assert.equal(snapshot2.boardFence, 1, 'pin: the claim left boardFence unmoved');
  assert.ok(Number.isSafeInteger(snapshot2.projectionInputFence),
    'stage[freshness gap]: the board snapshot/result projects projectionInputFence alongside boardFence (Decision 5/7)');
  const afterClaim = projectBoardView(snapshot2, viewer, cache);
  assert.equal(afterClaim.items[0].status, 'claimed',
    'stage[freshness gap]: the orchestrator re-read after the claim observes it — the cache key spans both fences (BW-14)');
  s.submitBoardReport({
    itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest, owner: 'w1', body: 'fresh evidence',
  }, { actor: 'worker', key: 'bw14:report' });
  const snapshot3 = s.boardSnapshot('shared');
  assert.equal(snapshot3.boardFence, 1, 'pin: the report left boardFence (and claim CAS) unmoved');
  const afterReport = projectBoardView(snapshot3, viewer, cache);
  assert.equal(afterReport.items[0].reports.length, 1,
    'stage[freshness gap]: a cached pre-report view is never served after the report — '
    + 'today the (board, viewer, boardFence) key hits and the report is invisible');
  assert.ok(text(afterReport.items[0].reports[0].body).includes('UNTRUSTED'), 'the report body stays untrusted prose');
});

// ===========================================================================
// BW-15 — L1 paging (stage: no L1 read lane; today's renderer sheds only
// trailing items at 512/256KiB and has no per-item report cap).
// ===========================================================================

test('BW-15 paging[l1-lane-missing]: pages cap at 16 items and 32 KiB with stable cursors, followed in-item report continuation, oversize-row truncation, and typed stale-cursor refusals', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  for (let i = 1; i <= 20; i += 1) s2Post(fx, { board: 'wave-board', title: `page item ${String(i).padStart(2, '0')}` });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw15:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });

  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null }, 'bw15:read:1');
  await flush(60);
  const page1 = readResults(fx, member).at(-1);
  assert.ok(page1, 'stage[L1 read lane missing]: the first page answers');
  const payload1 = page1.payload ?? {};
  const items1 = payload1.items ?? payload1.result?.items ?? [];
  assert.ok(items1.length >= 1 && items1.length <= 16, 'a page carries at most 16 items (Decision 5)');
  assert.ok(Buffer.byteLength(text(payload1)) <= 32 * 1024, 'a page serializes within 32 KiB (Decision 5)');
  const cursor = payload1.nextCursor ?? payload1.result?.nextCursor ?? null;
  assert.ok(cursor !== null && payload1.truncated === true,
    'more data yields a non-null nextCursor with truncated: true — never silent loss (BW-15)');
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor }, 'bw15:read:2');
  await flush(60);
  const page2 = readResults(fx, member).at(-1);
  const items2 = page2?.payload?.items ?? page2?.payload?.result?.items ?? [];
  const seen = new Set([...items1, ...items2].map((item) => item.itemId));
  assert.equal(seen.size, 20, 'the cursor chain pages the whole board stably by (ordinal,itemId), no duplicates, no loss');
  // A changed fence refuses the stale cursor with the typed code.
  s2Post(fx, { board: 'wave-board', title: 'late arrival' });
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor }, 'bw15:read:3');
  await flush(60);
  const stale = readResults(fx, member).at(-1);
  assert.ok(stale && text(stale.payload).includes('board_cursor_stale'),
    'a cursor whose bound fence moved refuses board_cursor_stale — never masquerades as fresh (Decision 5)');
  // Report pressure: one item with ~36 KiB of reports must paginate in-item by
  // (itemId, lastReportSeq) — the page never starves and never exceeds 32 KiB.
  const heavy = s2Post(fx, { board: 'wave-board', title: 'report heavy item' });
  for (let i = 1; i <= 12; i += 1) {
    fx.coordination.submitBoardReport({
      itemId: heavy.item.itemId, itemVersion: 1, itemDigest: heavy.item.itemDigest, owner: 'w1',
      body: `evidence ${i} ${'x'.repeat(2900)}`,
    }, { actor: 'worker', key: `bw15:heavy:${i}` });
  }
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null }, 'bw15:read:4');
  await flush(60);
  const heavyPage = readResults(fx, member).at(-1);
  const heavyPayload = heavyPage?.payload ?? {};
  assert.ok(Buffer.byteLength(text(heavyPayload)) <= 32 * 1024, 'the report-heavy page stays within 32 KiB');
  assert.ok((heavyPayload.items ?? heavyPayload.result?.items ?? []).length >= 1, 'the page is never empty (no starvation)');
  const heavyCursor = heavyPayload.nextCursor ?? heavyPayload.result?.nextCursor ?? null;
  assert.ok(heavyCursor !== null, 'an in-item (itemId, lastReportSeq) report continuation exists — reports are never stranded');
  // Follow the continuation chain (T7): every one of the 12 heavy reports arrives across the
  // in-item (itemId, lastReportSeq) continuation — never stranded behind a dummy nextCursor,
  // never starved into an empty page, never over budget (Decision 5; A5-1).
  const delivered = new Set();
  for (const match of text(heavyPayload).matchAll(/evidence (\d+) /g)) delivered.add(Number(match[1]));
  let contCursor = heavyCursor;
  for (let hop = 0; hop < 4 && contCursor !== null; hop += 1) {
    emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: contCursor }, `bw15:read:cont:${hop}`);
    await flush(60);
    const contPayload = readResults(fx, member).at(-1)?.payload ?? {};
    assert.equal(text(contPayload).includes('board_cursor_stale'), false,
      'the in-item report continuation stays fresh across the chain');
    assert.ok(Buffer.byteLength(text(contPayload)) <= 32 * 1024, 'every continuation page stays within 32 KiB');
    for (const match of text(contPayload).matchAll(/evidence (\d+) /g)) delivered.add(Number(match[1]));
    contCursor = contPayload.nextCursor ?? contPayload.result?.nextCursor ?? null;
  }
  assert.equal(delivered.size, 12,
    'following the (itemId, lastReportSeq) continuation delivers every remaining report — none stranded (Decision 5; A5-1)');
  // Oversize item row (A5-1): kernel bounds cap title (160 B) and detail (4 KiB), so a >32 KiB
  // row is built through the one unbounded item field — up to 8 evidence refs with free-form
  // artifactId strings (coordination-store.mjs:397-406). The row truncates with the typed
  // marker; the page never starves empty.
  const bigRef = (n) => ({ artifactId: `artifact:bw15:${n}:${'a'.repeat(5000)}` });
  s2Post(fx, { board: 'oversize-board', title: 'an item row over thirty-two KiB', evidence: [1, 2, 3, 4, 5, 6, 7, 8].map(bigRef) });
  await sendGrant(fx, { runId: 'run:member-a', board: 'oversize-board', idem: 'bw15:send:2' });
  const oversizeGrant = mintedGrant(fx, { board: 'oversize-board', memberRunId: 'run:member-a' });
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: oversizeGrant.grantId, cursor: null }, 'bw15:read:oversize');
  await flush(60);
  const osPayload = readResults(fx, member).at(-1)?.payload ?? {};
  const osItems = osPayload.items ?? osPayload.result?.items ?? [];
  assert.ok(osItems.length >= 1,
    'stage[oversize row unhandled]: the oversize item row is served truncated — never an empty page (Decision 5; A5-1)');
  assert.ok(Buffer.byteLength(text(osPayload)) <= 32 * 1024, 'the truncated oversize page still fits the 32 KiB budget');
  assert.ok(text(osPayload).includes('"truncated":true'),
    'stage[oversize row unhandled]: the oversize row carries truncated: true (Decision 5; A5-1)');
  assert.ok(text(osPayload).includes('board_oversize_item'),
    'stage[oversize row unhandled]: the oversize row carries the typed board_oversize_item marker (Decision 5; A5-1)');
});

// ===========================================================================
// BW-16 — read closure and cursor binding (stage: no L1 read lane; the query
// grammar and cursor digest binding do not exist).
// ===========================================================================

test('BW-16 closure[l1-lane-missing]: the read query rejects smuggled scope fields; revoked/foreign grants share board_worker_scope_refused', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  for (let i = 1; i <= 18; i += 1) s2Post(fx, { board: 'wave-board', title: `closure item ${i}` });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw16:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  // Smuggled scope fields the query must never carry (Decision 5: they are grant-derived).
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null, board: 'wave-board' }, 'bw16:read:1');
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null, workerId: 'w-mallory' }, 'bw16:read:2');
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null, runId: 'run:coord' }, 'bw16:read:3');
  await flush(60);
  const results = readResults(fx, member);
  assert.equal(results.length, 3, 'every smuggled query is receipted');
  for (const [index, field] of ['board', 'workerId', 'runId'].entries()) {
    assert.match(text(results[index].payload), /invalid/,
      `a query carrying a caller-named ${field} refuses at the closed wire grammar (Decision 5)`);
    assert.equal(text(results[index].payload).includes('closure item'), false,
      `the smuggled ${field} query serves no items`);
  }
  // A valid first page, then revocation: the cursor is rebound to authority on every use.
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null }, 'bw16:read:4');
  await flush(60);
  const page1 = readResults(fx, member).at(-1);
  const cursor = page1?.payload?.nextCursor ?? page1?.payload?.result?.nextCursor ?? null;
  assert.ok(cursor !== null, 'the valid read yields a continuation cursor');
  await killMember(fx, member.id);
  const member2 = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:member-a' });
  emitContextRead(fx.adapter, member2, { kind: 'board', grantId: grant.grantId, cursor }, 'bw16:read:5');
  await flush(60);
  const revived = readResults(fx, member2).at(-1);
  assert.ok(revived && text(revived.payload).includes('board_worker_scope_refused'),
    'a revoked grant\u2019s cursor refuses with the constant scope code — possession of the cursor is never authority '
    + '(Decisions 2/3/5; a new process generation needs a newly minted grant)');
});

// ===========================================================================
// BW-17 — steering/promotion isolation (stage: the claim/report result receipts
// do not exist; the danger is copying the scratchpad.write_result TG2 wiring).
// ===========================================================================

test('BW-17 isolation[tg2-wiring]: claim/report/read receipts never answer the steering cycle; reads append no board event and move no fence', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'isolation target' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw17:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const taskId = fx.driver.coordinator._workers.get(member.id)?.taskId
    ?? fx.driver.coordinator.list().find((row) => row.id === member.id)?.taskId;
  // Arm the TG2/TG3 steering cycle (bd3 A8 pattern): the pause waits for REAL liveness evidence.
  fx.adapter.emit({
    worker: member.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'checkpoint' },
  });
  await flush(60);
  assert.equal(fx.driver.coordinator.pausedTurns({ taskId }).length, 1, 'the steering cycle is armed');
  // A successful claim receipt is hub-admission evidence only — it must NOT settle the cycle
  // (the scratchpad.write_result block this lane is modeled on DOES feed TG2; not copied).
  const pBefore = fx.coordination.projectionInputFence();
  const fBefore = fx.coordination.boardFence('wave-board');
  const eventsBefore = fx.coordination.events().length;
  emitBoardClaim(fx.adapter, member, {
    grantId: grant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw17:c1',
  });
  await flush(60);
  assert.equal(claimResults(fx, member).length, 1,
    'stage[worker lane missing]: the claim receipt exists (paused is a live task status for the gate, Decision 1)');
  assert.equal(fx.coordination.activeBoardClaims({ workerId: member.id }).length, 1, 'the claim landed');
  assert.equal(fx.driver.coordinator.pausedTurns({ taskId }).length, 1,
    'the board.claim_result receipt never feeds _observeSteeringCycle (Decision 1; BW-17 oracle)');
  // The read receipt: only the zero-weight L1 audit/result receipt — no board-domain event,
  // neither freshness fence moves, no promotion weight.
  emitContextRead(fx.adapter, member, { kind: 'board', grantId: grant.grantId, cursor: null }, 'bw17:read:1');
  await flush(60);
  assert.equal(readResults(fx, member).length, 1, 'the read receipt exists');
  const newEvents = fx.coordination.events().slice(eventsBefore);
  assert.equal(newEvents.some((event) => event.kind === 'board.read'), false,
    'the read appends no board-domain read event (Decision 5)');
  assert.equal(fx.coordination.boardFence('wave-board'), fBefore, 'the read moves no board fence');
  const claimBumps = newEvents.filter((event) => event.kind === 'board.claim_requested').length;
  assert.equal(fx.coordination.projectionInputFence(), pBefore + claimBumps,
    'only the claim moved the freshness fence — the read adds nothing (Decision 5)');
  assert.equal(fx.driver.coordinator.pausedTurns({ taskId }).length, 1,
    'the context.read_result receipt never answers the TG2/TG3 cycle either');
});

// ===========================================================================
// BW-18a — orchestrator close/drop claim expiry (stage: today close/drop write
// only the item successor; the migration branch fires only for retitle/reorder).
// BEHAVIORAL RED at the kernel level — no new machinery required to fail.
// ===========================================================================

test('BW-18a close-expiry[batch-gap]: an orchestrator close/drop expires the item\u2019s active claim in the same batch', () => {
  for (const [kind, suffix] of [['close', 'item_closed'], ['drop', 'item_dropped']]) {
    const s = freshStore();
    const posted = s.postBoardItem({ board: 'shared', title: `target for ${kind}` }, { actor: 'fixture', key: `bw18a:post:${kind}` });
    const itemId = posted.item.itemId;
    const claim = s.requestBoardClaim({ itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: `bw18a:claim:${kind}` });
    assert.equal(claim.result, 'claimed');
    const receipt = kind === 'close'
      ? s.closeBoardItem(itemId, { actor: 'orchestrator', key: `bw18a:${kind}` })
      : s.dropBoardItem(itemId, { actor: 'orchestrator', key: `bw18a:${kind}` });
    assert.equal(receipt.ok, true);
    assert.equal(s.boardItem(itemId).state, kind === 'close' ? 'closed' : 'dropped');
    assert.equal(s.activeBoardClaims({ workerId: 'w1' }).length, 0,
      `stage[close/drop batch gap]: the orchestrator ${kind} expires the item\u2019s active claim in the same batch `
      + '(Decision 8); today the claim is orphaned active');
    const expiry = s.events().find((event) => event.kind === 'board.claim_expired' && event.payload?.itemId === itemId);
    assert.ok(expiry, `a board.claim_expired sibling event lands with the ${kind}`);
    assert.equal(expiry.actor, 'policy', 'the batch expiry actor is policy (mirrors _expireBoardClaims)');
    assert.equal(expiry.payload?.expectedClaimVersion, 1, 'the expiry is version-CAS, mirroring the worker-death lifecycle');
    const key = `board.claim_expired:${itemId}:1:${suffix}`;
    assert.ok(s.events().some((event) => event.idempotencyKey === key || event.key === key),
      `the expiry carries the contract key ${key} (Decision 8)`);
  }
});

// ===========================================================================
// BW-18b — grant lifecycle (stage: no grant events, no durable generation
// record; the worker-death claim expiry half is a PIN — it exists today).
// ===========================================================================

test('BW-18b lifecycle[grant-revoke-missing]: member death version-CAS-expires claims (pin) and revokes the grant; a new generation cannot reuse it', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'lifecycle target' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  // Pin half (green today — Decision 8 honors the existing worker-death claim reap).
  const kernelClaim = fx.coordination.requestBoardClaim({
    itemId: posted.item.itemId, owner: member.id, ownerTask: fx.driver.coordinator._workers.get(member.id)?.taskId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'),
  }, { actor: 'worker', key: 'bw18b:kernel-claim' });
  assert.equal(kernelClaim.result, 'claimed');
  // Red half: the grant the member can no longer use after death.
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw18b:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  await killMember(fx, member.id);
  assert.equal(fx.coordination.activeBoardClaims({ workerId: member.id }).length, 0,
    'pin: worker death version-CAS-expires every owned claim (existing behavior, Decision 8)');
  const revocations = fx.coordination.events().filter((event) => event.kind === 'board.grant_revoked'
    && text(event.payload).includes(grant.grantId));
  assert.ok(revocations.length >= 1,
    'stage[grant lifecycle missing]: the durable lifecycle transition appends board.grant_revoked naming the cause (Decision 2/8)');
  assert.ok(text(revocations[0].payload).match(/cause|reason/), 'the revocation names its terminator');
  // A replacement generation holds nothing: the old grant id is dead weight.
  const member2 = await spawnMember(fx, { runId: 'run:member-a2', role: 'exec-a' });
  emitBoardClaim(fx.adapter, member2, {
    grantId: grant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw18b:c2',
  });
  await flush(60);
  const results = claimResults(fx, member2);
  assert.equal(results.length, 1, 'the replacement generation\u2019s attempt is receipted');
  assert.ok(text(results[0].payload).includes('board_worker_scope_refused'),
    'a new process generation cannot use the revoked grant — replay cannot resurrect it (Decision 2/8)');
});

// ===========================================================================
// BW-19 — triage envelope (stage: projectBoardView emits claim:{owner,
// itemVersion, boardFence} and reports without claimVersion/createdEvent/
// eventSeq/owner coordinates — not enough CAS/provenance data to triage).
// ===========================================================================

test('BW-19 envelope[projection-gap]: board views project the closed claim/report envelope with event attribution and untrusted bodies', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'envelope target', owner: 'w1' }, { actor: 'fixture', key: 'bw19:post' });
  const claim = s.requestBoardClaim({ itemId: posted.item.itemId, owner: 'w1', expectedBoardFence: 1 }, { actor: 'worker', key: 'bw19:claim' });
  assert.equal(claim.result, 'claimed');
  s.submitBoardReport({
    itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest, owner: 'w1', body: 'triage me',
  }, { actor: 'worker', key: 'bw19:report' });
  const view = projectBoardView(s.boardSnapshot('shared'), { role: 'orchestrator', workerId: null }, null);
  const row = view.items[0];
  const projectedClaim = row.claim ?? {};
  for (const field of ['itemId', 'itemVersion', 'boardFence', 'claimVersion', 'ownerWorkerId', 'ownerTaskId', 'grantDigest', 'createdEvent', 'active']) {
    assert.ok(Object.hasOwn(projectedClaim, field),
      `stage[envelope gap]: the projected claim carries ${field} (Decision 7's closed envelope); `
      + 'today the projection emits only {owner, itemVersion, boardFence}');
  }
  assert.equal(projectedClaim.claimVersion, 1, 'the claim CAS coordinate is visible to triage');
  assert.equal(projectedClaim.ownerWorkerId, 'w1', 'the owner coordinate uses the contract name');
  const projectedReport = (row.reports ?? [])[0] ?? {};
  for (const field of ['itemId', 'itemVersion', 'itemDigest', 'claimVersion', 'ownerWorkerId', 'ownerTaskId', 'grantDigest', 'body', 'eventSeq']) {
    assert.ok(Object.hasOwn(projectedReport, field),
      `stage[envelope gap]: the projected report carries ${field} (Decision 7's closed envelope)`);
  }
  assert.equal(projectedReport.eventSeq >= 1, true, 'the report\u2019s durable sequence is projected for CAS auditing');
  assert.ok(text(projectedReport.body).includes('UNTRUSTED'), 'pin: the report body stays visibly untrusted worker prose');
  assert.ok(text(row.title).includes('UNTRUSTED'), 'pin: the item title stays provenance-framed');
});

// ===========================================================================
// BW-20 — the #74 loop (stage: end-to-end acceptance; fails today at the first
// missing piece — the waves.send claim grant). Every assertion keys on durable
// ids/digests/events and content/state predicates — never a clock or counter.
// ===========================================================================

test('BW-20 loop[#74-e2e]: orchestrator posts two items, grants two members, members read/contend/claim/report, a coordinator-worker triages, and the S-2 close follows the selected report', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const itemOne = s2Post(fx, { board: 'wave-board', title: 'decomposed work one' });
  const itemTwo = s2Post(fx, { board: 'wave-board', title: 'triage recommendations' });
  const memberA = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  const memberB = await spawnMember(fx, { runId: 'run:member-b', role: 'exec-b' });
  // The triage member performs the #74 coordinator-worker function through its OWN board item
  // (claim + report), so the orchestrator-selected grant recorded for it is the executor-class
  // {read,claim,report} subset (Decision 2: the caller names no permissions; the server records
  // the selection). A triage-ONLY coordinator-worker receiving exactly {read} — and refused on
  // claim — is BW-22's row; this member's role stays executor-class so the two rows name one
  // consistent permission law.
  const triager = await spawnMember(fx, { runId: 'run:member-c', role: 'exec-c' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw20:send:a' });
  await sendGrant(fx, { runId: 'run:member-b', board: 'wave-board', idem: 'bw20:send:b' });
  await sendGrant(fx, { runId: 'run:member-c', board: 'wave-board', idem: 'bw20:send:c' });
  const grantA = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const grantB = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-b' });
  const grantC = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-c' });
  assert.notEqual(grantA.grantId, grantB.grantId, 'grants are member-bound, never shared');
  // Both executors read the shared board.
  emitContextRead(fx.adapter, memberA, { kind: 'board', grantId: grantA.grantId, cursor: null }, 'bw20:read:a');
  emitContextRead(fx.adapter, memberB, { kind: 'board', grantId: grantB.grantId, cursor: null }, 'bw20:read:b');
  await flush(60);
  for (const [member, name] of [[memberA, 'A'], [memberB, 'B']]) {
    const page = readResults(fx, member).at(-1);
    assert.ok(page && text(page.payload).includes('decomposed work one'), `${name} reads the shared item`);
    assert.ok(text(page.payload).includes('boardFence') && text(page.payload).includes('projectionInputFence'),
      `${name}\u2019s page projects both read-freshness fence components (Decision 5)`);
  }
  // Contention on item one: exactly one winner; the loser receives the typed race outcome.
  const fence = fx.coordination.boardFence('wave-board');
  emitBoardClaim(fx.adapter, memberA, { grantId: grantA.grantId, itemId: itemOne.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw20:c:a' });
  emitBoardClaim(fx.adapter, memberB, { grantId: grantB.grantId, itemId: itemOne.item.itemId, expectedBoardFence: fence, idempotencyKey: 'bw20:c:b' });
  await flush(80);
  const claimEvents = fx.coordination.events().filter((event) => event.kind === 'board.claim_requested'
    && event.payload?.itemId === itemOne.item.itemId);
  assert.equal(claimEvents.length, 1, 'first active claim wins — exactly one durable claim');
  const winnerId = claimEvents[0].payload?.owner;
  const loser = winnerId === memberA.id ? memberB : memberA;
  const loserResults = claimResults(fx, loser);
  assert.ok(loserResults.length >= 1
    && /conflict|stale_board_fence/.test(text(loserResults.at(-1).payload)),
  'the losing claimant receives the typed conflict/stale_board_fence outcome from the serialized state (Decision 6 rule 5)');
  // The winner reports against its active claim version and the exact observed digest.
  const winner = winnerId === memberA.id ? memberA : memberB;
  const winnerGrant = winnerId === memberA.id ? grantA : grantB;
  emitBoardReport(fx.adapter, winner, {
    grantId: winnerGrant.grantId, itemId: itemOne.item.itemId, itemVersion: 1, itemDigest: itemOne.item.itemDigest,
    expectedClaimVersion: 1, body: 'work one complete — evidence attached', idempotencyKey: 'bw20:r:winner',
  });
  await flush(60);
  const reportEvents = fx.coordination.events().filter((event) => event.kind === 'board.report_submitted'
    && event.payload?.itemId === itemOne.item.itemId);
  assert.equal(reportEvents.length, 1, 'the winner\u2019s report is durable and worker-attributed');
  assert.equal(reportEvents[0].payload?.owner, winnerId);
  // The coordinator-worker reads fresh pages, sees BOTH admitted envelopes, and reports its
  // triage recommendation through its own board item.
  emitContextRead(fx.adapter, triager, { kind: 'board', grantId: grantC.grantId, cursor: null }, 'bw20:read:c');
  await flush(60);
  const triagePage = readResults(fx, triager).at(-1);
  assert.ok(triagePage && text(triagePage.payload).includes(winnerId),
    'the coordinator-worker sees the winner\u2019s claim envelope with its owner coordinates');
  assert.ok(text(triagePage.payload).includes('work one complete'), 'the coordinator-worker sees the report envelope');
  emitBoardClaim(fx.adapter, triager, {
    grantId: grantC.grantId, itemId: itemTwo.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw20:c:c',
  });
  await flush(60);
  emitBoardReport(fx.adapter, triager, {
    grantId: grantC.grantId, itemId: itemTwo.item.itemId, itemVersion: 1, itemDigest: itemTwo.item.itemDigest,
    expectedClaimVersion: 1, body: `triage: accept ${winnerId}'s report on item one`, idempotencyKey: 'bw20:r:c',
  });
  await flush(60);
  assert.ok(fx.coordination.events().some((event) => event.kind === 'board.report_submitted'
    && event.payload?.itemId === itemTwo.item.itemId && event.payload?.owner === triager.id),
  'the triage recommendation lands through the coordinator-worker\u2019s own board item (Decision 7 step 5)');
  // The orchestrator remains the closer: one S-2 close follows the selected report.
  const closed = fx.coordination.admitBoardCommand({
    sessionAuthority: fx.orch.sessionAuthority, runId: 'run:coord', board: 'wave-board',
    item: { itemId: itemOne.item.itemId, itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw20:close:1',
  });
  assert.equal(closed.ok, true, 'the orchestrator\u2019s S-2 close receipt lands');
  assert.equal(fx.coordination.boardItem(itemOne.item.itemId).state, 'closed');
  assert.equal(fx.coordination.activeBoardClaims({ workerId: winnerId }).length, 0,
    'the close expires the winner\u2019s claim in the same batch (Decision 8; BW-18a)');
});

// ===========================================================================
// BW-22 — grant permission enforcement (stage: no grant machinery; an
// implementation hardcoding {read,claim,report} for every member greens the
// pre-fold suite — precisely the A2-2 coordinator-worker over-grant). The mint
// must RECORD the orchestrator-selected subset and the seam must ENFORCE it
// before item lookup (Decision 2 permissions; Decision 3 step 4).
// ===========================================================================

test('BW-22 permissions[grant-permission-missing]: the mint records the orchestrator-selected subset (executor {read,claim,report}, triage-only {read}) and a read-only grant\u2019s claim refuses board_worker_scope_refused before item lookup', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'permission target' });
  const exec = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  const triage = await spawnMember(fx, { runId: 'run:member-c', role: 'coordinator-worker' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw22:send:a' });
  await sendGrant(fx, { runId: 'run:member-c', board: 'wave-board', idem: 'bw22:send:c' });
  const execGrant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  const triageGrant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-c' });
  // The recorded subset is the orchestrator's per-member selection, never a hardcoded set
  // (Decision 2; A2-2): the executor works items, the triage-only coordinator-worker only reads.
  assert.deepEqual([...execGrant.permissions].sort(), ['claim', 'read', 'report'],
    'stage[grant permission missing]: the executor member\u2019s grant records the full {read,claim,report} subset (Decision 2)');
  assert.deepEqual([...triageGrant.permissions].sort(), ['read'],
    'stage[grant permission missing]: the triage-only coordinator-worker\u2019s grant records exactly {read} — the over-grant a hardcoded set would green (A2-2)');
  // The read-only grant's claim attempts draw the constant refusal BEFORE item lookup.
  emitBoardClaim(fx.adapter, triage, {
    grantId: triageGrant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw22:c1',
  });
  emitBoardClaim(fx.adapter, triage, {
    grantId: triageGrant.grantId, itemId: 'board-item:bw22-absent',
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw22:c2',
  });
  await flush(60);
  const results = claimResults(fx, triage);
  assert.equal(results.length, 2, 'both read-only claim attempts are receipted');
  for (const receipt of results) {
    assert.ok(text(receipt.payload).includes('board_worker_scope_refused'),
      'a grant recorded without the claim permission receives the constant board_worker_scope_refused (Decision 3 step 4)');
    assert.equal(text(receipt.payload).includes('board_item_not_found'), false,
      'the permission refusal precedes item lookup — no existence leak (Decision 3)');
  }
  assert.equal(fx.coordination.events().filter((event) => event.kind === 'board.claim_requested').length, 0,
    'no claim event lands from a permission-denied attempt');
  // Positive controls: the read-only grant still reads; the claim-capable grant still claims.
  emitContextRead(fx.adapter, triage, { kind: 'board', grantId: triageGrant.grantId, cursor: null }, 'bw22:read:1');
  emitBoardClaim(fx.adapter, exec, {
    grantId: execGrant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw22:c3',
  });
  await flush(60);
  const read = readResults(fx, triage).at(-1);
  assert.ok(read && text(read.payload).includes('"ok":true'),
    'control: the read-only grant still reads the granted board (Decision 5)');
  assert.equal(fx.coordination.activeBoardClaims({ workerId: exec.id }).length, 1,
    'control: the executor\u2019s claim-permission grant claims the item (a refuse-everything seam fails here)');
});

// ===========================================================================
// BW-23 — Decision 6 rule 4 at the seam (stage: no grant machinery; a
// live-state-first replay implementation greens the pre-fold suite). After
// authorization and exact replay matching, the ORIGINAL result wins over later
// live state; a revoked grant cannot replay.
// ===========================================================================

test('BW-23 replay[replay-wins-over-live-state]: an exact authorized report retry returns the original receipt after the item closes; a revoked grant cannot replay it', async () => {
  const fx = await waveFixture();
  bindWaveRun(fx, 'run:coord', 'coordination');
  const posted = s2Post(fx, { board: 'wave-board', title: 'replay rule-4 target' });
  const member = await spawnMember(fx, { runId: 'run:member-a', role: 'exec-a' });
  await sendGrant(fx, { runId: 'run:member-a', board: 'wave-board', idem: 'bw23:send:1' });
  const grant = mintedGrant(fx, { board: 'wave-board', memberRunId: 'run:member-a' });
  emitBoardClaim(fx.adapter, member, {
    grantId: grant.grantId, itemId: posted.item.itemId,
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw23:c1',
  });
  await flush(60);
  assert.equal(fx.coordination.activeBoardClaims({ workerId: member.id }).length, 1, 'the claim is active');
  const reportFrame = {
    grantId: grant.grantId, itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest,
    expectedClaimVersion: 1, body: 'evidence whose receipt was lost', idempotencyKey: 'bw23:r1',
  };
  emitBoardReport(fx.adapter, member, reportFrame);
  await flush(60);
  const first = reportResults(fx, member).find((event) => text(event.payload).includes('bw23:r1'));
  assert.ok(first && text(first.payload).includes('"ok":true'),
    'the original report is admitted and receipted (rule-4 setup)');
  // Live state moves on: the orchestrator S-2 close terminates the item (and expires the claim).
  const closed = fx.coordination.admitBoardCommand({
    sessionAuthority: fx.orch.sessionAuthority, runId: 'run:coord', board: 'wave-board',
    item: { itemId: posted.item.itemId, itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: fx.coordination.boardFence('wave-board'), idempotencyKey: 'bw23:close:1',
  });
  assert.equal(closed.ok, true);
  assert.equal(fx.coordination.boardItem(posted.item.itemId).state, 'closed');
  // The lost receipt is recovered: the exact retry returns the ORIGINAL success — the close's
  // live state (terminal item, expired claim) is never re-judged (Decision 6 rule 4).
  emitBoardReport(fx.adapter, member, reportFrame);
  await flush(60);
  const receipts = reportResults(fx, member).filter((event) => text(event.payload).includes('bw23:r1'));
  assert.equal(receipts.length, 2, 'the exact retry is receipted on the same stream');
  assert.ok(text(receipts[1].payload).includes('"ok":true'),
    'stage[replay-wins-over-live-state missing]: the exact authorized retry returns the original success even after the close (Decision 6 rule 4)');
  assert.equal(/not_open|stale|conflict/.test(text(receipts[1].payload)), false,
    'the replay never re-judges the original request against later live state');
  assert.equal(fx.coordination.events().filter((event) => event.kind === 'board.report_submitted').length, 1,
    'the replay appends no duplicate report');
  // A revoked grant cannot replay the same effective key (rules 1/4: authority before replay).
  await killMember(fx, member.id);
  const member2 = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:member-a' });
  emitBoardReport(fx.adapter, member2, reportFrame);
  await flush(60);
  const revived = reportResults(fx, member2).filter((event) => text(event.payload).includes('bw23:r1'));
  assert.equal(revived.length, 1, 'the post-revocation attempt is receipted');
  assert.ok(text(revived[0].payload).includes('board_worker_scope_refused'),
    'stage[replay-wins-over-live-state missing]: a revoked grant cannot replay the original success — authority precedes replay (Decision 6 rules 1/4)');
  assert.equal(text(revived[0].payload).includes('"ok":true'), false,
    'the revoked grant\u2019s replay never returns the old success');
});

// ===========================================================================
// BW-24 — wire scanner rows (stage: claude-session.mjs exports no
// scanForBoardClaim/scanForBoardReport — the BOARD_CLAIM/BOARD_REPORT text
// frames have no closed scanner; A1-1). Mirrors scratchpad-33's
// scanForScratchpadWrite discipline. The module is imported as a NAMESPACE so a
// missing export fails THIS row's named stage instead of killing the file at
// load (a named import of a missing export would turn every row red for the
// wrong reason).
// ===========================================================================

test('BW-24 scanner[frame-scanner-missing]: BOARD_CLAIM/BOARD_REPORT text frames scan with exact-key + first-balanced-JSON discipline; identity fields and second frames reject', () => {
  assert.equal(typeof session.scanForBoardClaim, 'function',
    'stage[wire scanner missing]: the adapter session scanner gains scanForBoardClaim (Decision 1; A1-1)');
  assert.equal(typeof session.scanForBoardReport, 'function',
    'stage[wire scanner missing]: the adapter session scanner gains scanForBoardReport (Decision 1; A1-1)');
  // Exact-key acceptance (Decision 1's closed frame shapes).
  const claim = session.scanForBoardClaim(
    'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":7,"idempotencyKey":"bw24:c1"}');
  assert.ok(claim, 'a well-formed BOARD_CLAIM frame scans');
  assert.deepEqual(Object.keys(claim).sort(), ['expectedBoardFence', 'grantId', 'idempotencyKey', 'itemId'],
    'the scanned claim frame carries exactly the closed key set');
  const report = session.scanForBoardReport(
    'BOARD_REPORT: {"grantId":"grant:bw24","itemId":"board-item:bw24","itemVersion":2,'
    + `"itemDigest":"${'a'.repeat(64)}","expectedClaimVersion":1,"body":"evidence","idempotencyKey":"bw24:r1"}`);
  assert.ok(report, 'a well-formed BOARD_REPORT frame scans');
  assert.deepEqual(Object.keys(report).sort(),
    ['body', 'expectedClaimVersion', 'grantId', 'idempotencyKey', 'itemDigest', 'itemId', 'itemVersion'],
    'the scanned report frame carries exactly the closed key set');
  // First-balanced-JSON extraction: ordinary trailing prose never reaches the parse.
  const withProse = session.scanForBoardClaim(
    'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":7,"idempotencyKey":"bw24:c2"} and then some ordinary prose');
  assert.ok(withProse && withProse.idempotencyKey === 'bw24:c2',
    'the scanner extracts the first balanced JSON object and ignores trailing prose (A1-1)');
  // Identity/scope-field rejection (Decision 1: none of these is accepted, before any state lookup).
  for (const field of ['workerId', 'owner', 'ownerTask', 'actor', 'taskId', 'runId', 'waveId', 'board', 'boardRunId', 'sessionAuthority']) {
    const smuggled = session.scanForBoardClaim(
      `BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":7,"idempotencyKey":"bw24:c3","${field}":"x"}`);
    assert.equal(smuggled, null, `a frame carrying caller-named ${field} is rejected by the closed scanner (Decision 1)`);
  }
  // Second-frame rejection: two frames in one scan window are rejected, never first-wins.
  assert.equal(session.scanForBoardClaim(
    'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":7,"idempotencyKey":"bw24:c4"} '
    + 'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":8,"idempotencyKey":"bw24:c5"}'), null,
  'a second frame in the same scan window rejects the whole scan (A1-1)');
  assert.equal(session.scanForBoardReport(
    'BOARD_REPORT: {"grantId":"grant:bw24","itemId":"board-item:bw24","itemVersion":2,'
    + `"itemDigest":"${'a'.repeat(64)}","expectedClaimVersion":1,"body":"one","idempotencyKey":"bw24:r2"} `
    + 'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":7,"idempotencyKey":"bw24:c6"}'), null,
  'a trailing sibling frame rejects the report scan too');
  // Malformed values reject like any non-grammar text.
  assert.equal(session.scanForBoardClaim(
    'BOARD_CLAIM: {"grantId":"grant:bw24","itemId":"board-item:bw24","expectedBoardFence":-1,"idempotencyKey":"bw24:c7"}'), null,
  'a negative fence rejects');
  assert.equal(session.scanForBoardReport(
    'BOARD_REPORT: {"grantId":"grant:bw24","itemId":"board-item:bw24","itemVersion":2,'
    + '"itemDigest":"not-a-digest","expectedClaimVersion":1,"body":"x","idempotencyKey":"bw24:r3"}'), null,
  'a non-64-hex itemDigest rejects');
  assert.equal(session.scanForBoardClaim('no frame here at all'), null, 'plain prose scans to null');
});
