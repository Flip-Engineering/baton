// Orientation ladder red suite (contract: docs/reference/evidence/
// frontier-sweep-2026-08-03/orientation-contract.md v1.0 — epic #81, post-red-team fold).
//
// Thirty-eight rows over the eight folded decisions:
//   O-1 the ladder (bounded map/region/detail tiers, closed leaf union, hub-derived scope,
//       detail-descends-from-citation, moduleKey derivation, renderer rejection) — OR-L1..OR-L5, OR-L8..OR-L10;
//   O-2 investigation receipts (context.read ZERO weight, hub-derived replay/conflict,
//       constructive per-attempt ceilings, orientation.candidate.propose) — OR-L6, OR-E1..OR-E4, OR-E8, OR-E9;
//   O-3 freshness (one attested {repoId, baseTreeSha, indexEpoch, baseInputsDigest} record,
//       freshnessDigest on every answer, serve/reverify/resume gates) — OR-F1..OR-F4;
//   O-4 generated-with-curation-overlay (KG Source + Cites, overlay_dangling/overlay_conflict) — OR-E5, OR-E10;
//   O-5 citation vs continuation vs grant (resume re-authorizes, transport strips paths,
//       needs_resume honesty, storage ceiling + retirement) — OR-C1..OR-C6;
//   O-6 spawn-time L0 + mid-turn pull (L0 cited into every brief, spawn head-CAS, grant
//       ordering/dedup, NO clock) — OR-S1..OR-S4;
//   O-7 closed rating event (hub-derived payload, constant refusal, replay/conflict, advisory) — OR-L7, OR-E6, OR-E7;
//   O-8 answer-time availability (orientation_unavailable, coverage object, partial labeling) — OR-A1..OR-A3;
//   plus the TG2/TG3 farm-guard pin OR-T1.
//
// Post-spine tree state (the BD3 collaboration spine landed in 726e34a, the suite commit's
// parent): the context.read wire lane EXISTS — it admits the closed
// {expectedFence, idempotencyKey, query} shape, refuses unknown kinds with
// context_read_invalid, and receipts REFUSED reads too (coordinator.mjs:10236-10257, :10345,
// :11578-11591). store.recordContextRead / mintContextPack / contextPackHead are landed
// (coordination-store.mjs:12950-13006), and materializeContextPack carries BD3-B's own
// contract-adopted wall-clock window (context_pack_expired at :12977 under
// DEFAULT_CONTEXT_PACK_VALIDITY :445) — the v1.0 fold forbids the clock on THIS epic's
// orientation surface, NOT in the spine. Consequences: lane rows red on ok:true /
// contract-tuple / citation teeth (never on receipt existence — refusals are receipted),
// OR-E1/OR-E2 pin legitimately landed behavior, OR-S3 pins the campaign law scoped to
// orientation-specific identifiers only.
//
// Invented surfaces (the contract adopts event kinds, triggers, and refusal codes — NOT store
// APIs; these names are the suite's contract with implementers, reconciled with the blue-team
// report docs/reference/evidence/frontier-sweep-2026-08-03/orientation-blueteam.md §5):
//   - store.recordContextRead(fields, auth) — LANDED (BD3-A). The suite's fixtures use the
//     CONTRACT's O-2 tuple field `normalizedQueryDigest`; the landed BD3-A mint shape
//     ({runId, taskId, workerId, kind, queryDigest, resultDigest}, coordinator.mjs:10267-10273)
//     differs from BOTH — OR-L6 pins the full contract tuple on the wire mint.
//   - store.recordOrientationRating({packDigest, rating}, {actor, key, attempt}) — `attempt`
//     is the suite's transport for the hub-derived attempt identity (OR-E6/OR-E7); OR-E6 also
//     pins that a caller-forged attempt tuple refuses (hub-derivation, never caller trust).
//   - store.mintOrientationSource({repoId, moduleKey, moduleDigest, freshnessDigest}, auth)
//   - store.proposeOrientationCandidate({packDigest, leafDigest}, auth)
//   - store.mergeOrientationMap({repoId, moduleKey, moduleDigest, freshnessDigest})
//   - CoordinationStore opts.orientationReceiptCeilings {maxReceiptsPerAttempt,
//     maxReceiptBytesPerAttempt, maxProposalsPerAttempt}; AtlasCodeIndex
//     opts.maxOrientationStorageBytes
//   - the `orientation.rate` wire kind ({packDigest, rating, idempotencyKey})
//   - OR-S1's brief-field probe (orientation ?? contextPacks ?? packs) for the L0 grant
//   - the `context.pack_granted` event kind (O-6: appended atomically with the spawn binding
//     BEFORE provider dispatch; attempt-scoped payload {packId, runId, taskId, taskVersion,
//     workerId}) — counted by OR-S2/OR-S4
//   - the code lane answers through the Coordinator's `capabilities` registry seam
//     (coordinator.mjs:821): OR-L5/OR-L10 wire a real AtlasCodeIndex over a real git repo
//     there; OR-L8 exercises the ONE renderer at coordinator._renderContextRead
//   - invented refusal codes: `orientation_receipt_ceiling` (O-2 per-attempt ceilings,
//     OR-E3/OR-E8) and `orientation_propose_refused` (O-2 prior-receipt verification, OR-E9)
//
// Red-first: written against the v1.0 contract BEFORE implementation. Every row fails today for
// the NAMED stage in its title (missing lane / missing class / missing gate in existing
// machinery), never a fixture bug, and goes green ONLY on the contract-correct implementation.
// Harness architecture mirrors test/bidirectional-v3-red.test.mjs (ScriptableAdapter +
// Coordinator + fake worktrees for lane rows; pure CoordinationStore for store rows) and
// test/atlas-orientation-red.test.mjs (createDriver + real git repo for the ATLAS/cartographer
// rows); the completed()+readScratch+promote fixture mirrors test/phase49-cairn-promotion.test.mjs
// and the admission-lease fixture mirrors test/kg-activation-red.test.mjs.
//
// Campaign law: no clocks, TTLs, or turn-limits in assertions; async settling uses bounded
// flush() loops only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { AtlasCodeIndex } from '../src/atlas-index.mjs';
import { CapabilityRegistry, createDriver } from '../src/index.mjs';

// ===========================================================================
// Shared fixtures
// ===========================================================================

const dirs = [];
function tmpDir(label = 'or') {
  const d = mkdtempSync(join(tmpdir(), `baton-orientation-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function digest(value) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function refusalCode(fn) {
  try { fn(); return null; } catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Lane harness (mirrors bidirectional-v3-red): ScriptableAdapter + Coordinator.
// ---------------------------------------------------------------------------

function makeBrief(overrides = {}) {
  return {
    goal: 'orient to the codebase, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
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

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir('lane');
  const log = new Log(join(dir, 'log'));
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

// The worker-pull surface this epic rides: BD3-A's `code` query kind on the context.read wire.
function emitCodeRead(adapter, handle, query, key) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query, expectedFence: 'current', idempotencyKey: key },
  });
}

function readResults(coordinator, handle) {
  return coordinator._log.read(handle.id).filter((event) => event.kind === 'context.read_result');
}

// ---------------------------------------------------------------------------
// Driver harness (mirrors atlas-orientation-red): real git repo + createDriver.
// ---------------------------------------------------------------------------

const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
};
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const repo = (name, files) => {
  const root = tmpDir(name);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'orientation@example.invalid']);
  git(root, ['config', 'user.name', 'Orientation Contract']);
  for (const [path, value] of Object.entries(files)) write(root, path, value);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return root;
};
const atlasConfig = (root) => ({
  artifactRoot: join(root, 'atlas-artifacts'),
  maxArtifactBytes: 256 * 1024,
  maxSourceBytes: 64 * 1024,
  maxFiles: 64,
  maxResults: 256,
});
const driver = (root, overrides = {}) => createDriver({
  repoRoot: root,
  repoId: 'orientation-contract-repo',
  logDir: tmpDir('log'),
  adapters: {},
  atlas: atlasConfig(root),
  maxCapabilityBudgetTokens: 20_000,
  maxCapabilityEnvelopeBytes: 512 * 1024,
  ...overrides,
});

// The artifact byte path derived from the fixture's OWN artifact root + the ref digest —
// NEVER the worker-visible ref.path key (OR-C2's contract-correct implementation deletes
// that field; blue-team blocker 5). The layout is fixture-deterministic shipped machinery:
// the driver's atlas config (above) + index.mjs's 'index' subroot + the AtlasCodeIndex CAS
// layout (resultRoot = <artifactRoot>/results, artifacts at <digest>.json — atlas-index.mjs:237, :278).
const atlasArtifactPath = (root, ref) => join(root, 'atlas-artifacts', 'index', 'results', `${ref.digest}.json`);

// Lane + real ATLAS registry: the code lane's answer source per the invented-surface contract
// (header) — a real AtlasCodeIndex over a real git repo, registered through the same
// CapabilityRegistry seam the driver uses (Coordinator opts.capabilities, coordinator.mjs:821).
function orientedLane(files, label) {
  const root = repo(label, files);
  const adapter = new ScriptableAdapter();
  const capabilities = new CapabilityRegistry({
    capabilities: {
      'atlas-index': new AtlasCodeIndex({
        artifactRoot: join(root, 'atlas-artifacts', 'index'), maxArtifactBytes: 256 * 1024,
        maxSourceBytes: 64 * 1024, maxFiles: 64, maxResults: 256,
      }),
    },
    contexts: { 'atlas-index': { baseRoot: root } },
    maxBudgetTokens: 20_000, maxEnvelopeBytes: 512 * 1024, root,
    record: () => null,
  });
  const { coordinator } = setup({ adapter, capture: noDiff, coordinatorOpts: { capabilities } });
  return { root, adapter, coordinator };
}

// ---------------------------------------------------------------------------
// Store harness (mirrors phase49-cairn-promotion + bidirectional A6b).
// ---------------------------------------------------------------------------

function makeStore(label = 'store', opts = {}) {
  return new CoordinationStore(tmpDir(label), { repoId: 'repo-a', clock: () => '2026-08-03T00:00:00.000Z', ...opts });
}

function complete(store, id, worker) {
  store.createTask({
    id, brief: { objective: `${id} work` }, deps: [], refines: null, relation: 'root', runId: `run-${id}`,
    taskType: 'general', reservedWorkerId: worker, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task:${id}` });
  store.claimTask(id, worker, 1, { actor: 'orchestrator', key: `claim:${id}` }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","mock-model","low"]',
  });
  store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `complete:${id}` });
  store.promoteKnowledgeNode({
    id: `outcome:${id}`, taskId: id, type: 'Finding', grounding: 'verified',
    body: `Task ${id} passed its hub verification`, evidence: [{ coordinationSeq: 1 }],
  }, { kind: 'Finding', trigger: 'verified_task_outcome' }, { actor: 'policy', key: `outcome:${id}` });
}

const promotionPolicy = (overrides = {}) => ({
  repoId: 'repo-a', minScratchReaders: 1, maxScanEvents: 1024, maxCandidates: 128,
  maxCandidateBytes: 256 * 1024, maxEvidenceRefs: 1024, maxBatchBytes: 512 * 1024,
  maxResultBytes: 128 * 1024, ...overrides,
});

// The run-orchestrator lease fixture for the workflow admission gate (mirrors kg-activation-red).
const lineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4, leaseTtlMs: 60_000,
});
const workflowAdmissionPolicy = Object.freeze({ repoId: 'repo-a', maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

function admissionFixture(label) {
  const store = makeStore(label, { runLineagePolicy: lineagePolicy });
  const runId = `run-${label}`;
  const taskId = `task-${label}`;
  const workerId = `worker-${label}`;
  store.createTask({
    id: taskId, brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = {
    principalId: `principal-${label}`, sessionId: `session-${label}`,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: `principal-${label}`, sessionId: `session-${label}` }),
    expiresAt: '2026-08-03T09:00:00.000Z',
  };
  const leaseRequest = { schemaVersion: 1, repoId: 'repo-a', parentTask: { id: taskId, version: task.version }, session };
  const leaseIdentity = {
    repoId: 'repo-a', parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version, workerId,
    principalId: session.principalId, sessionId: session.sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(leaseIdentity)}`;
  const issued = store.issueRunOrchestratorLease(leaseRequest, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  const posted = store.postBoardItem({ board: `board-${label}`, title: 'do the thing' }, { actor: 'orchestrator', key: `post-${label}` });
  const closed = store.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: `close-${label}` });
  const candidateFindingId = `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`;
  return { store, runId, taskId, lease, candidateFindingId };
}

// ===========================================================================
// O-1 — the orientation ladder (stage: the `code` query kind is not admitted and the
// orientation tiers do not exist. Post-726e34a the wire lane EXISTS: it admits the closed
// {expectedFence, idempotencyKey, query} shape, refuses unknown kinds with
// context_read_invalid, and receipts REFUSED reads too — coordinator.mjs:10236-10257,
// :10345, :11578-11591 — so these rows red on ok:true / citation / tuple teeth, never on
// receipt existence).
// ===========================================================================

test('OR-L1 [stage: code-lane-missing]: code.orient.map answers ONE bounded pack with freshnessDigest, coverage, and a module rollup (never verbatim repo.map)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-l1-read');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 1, 'exactly one read result on the worker stream (the code query kind is hub-admitted and answered)');
  const payload = results[0].payload ?? {};
  assert.equal(payload.ok ?? null, true, 'an in-scope map query answers');
  const body = JSON.stringify(payload);
  assert.match(body, /context-pack:[a-f0-9]{64}|packDigest/u, 'the answer is a content-addressed context-pack citation (BD3-B), not pasted prose');
  const map = payload.map ?? payload.result ?? {};
  assert.ok(Buffer.byteLength(JSON.stringify(map)) <= 2048, 'the map tier is constructively bounded <= 2KiB');
  assert.match(String(payload.freshnessDigest ?? ''), /^[a-f0-9]{64}$/u, 'one freshnessDigest over {repoId, baseTreeSha, indexEpoch, overlayDigest, scopeDigest}');
  for (const key of ['totalFiles', 'supportedFiles', 'unsupportedFiles', 'excludedFiles', 'parseErrorFiles', 'parseErrorCount']) {
    assert.equal(typeof payload.coverage?.[key], 'number', `coverage.${key} is preserved on the answer`);
  }
  const modules = map.modules ?? [];
  assert.ok(Array.isArray(modules) && modules.length >= 1, 'the map rolls flat per-file records up into modules');
  for (const module of modules) {
    assert.match(String(module.moduleDigest ?? ''), /^[a-f0-9]{64}$/u, 'moduleDigest = sha256(sorted member {path, contentDigest})');
    assert.ok('purpose' in module || 'entryPoints' in module || 'ownership' in module,
      'the rollup carries curated-overlay fields repo.map never has (purposes/entry points/ownership)');
  }
});

test('OR-L2 [stage: code-lane-missing]: every map leaf is in the closed union and reaches the worker framed through the ONE renderer', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-l2-read');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 1, 'the map answers (stage: code query kind missing)');
  assert.equal(results[0].payload?.ok ?? null, true, 'the map ANSWERS — a receipted refusal never satisfies this row');
  const modules = results[0].payload?.map?.modules ?? [];
  assert.ok(Array.isArray(modules) && modules.length >= 1, 'the map rolls flat per-file records up into modules');
  const proseLeaves = modules.flatMap((module) => {
    assert.ok(Array.isArray(module.leaves), 'every module carries its leaves array — the closed-union loop below can never be vacuous (blue-team T-2)');
    return module.leaves;
  });
  for (const leaf of proseLeaves) {
    if (leaf.source === 'generated') {
      assert.equal(typeof leaf.text, 'undefined', 'generated leaves carry typed structural fields only, never free prose');
    } else {
      assert.equal(leaf.untrusted, true, 'every prose leaf carries untrusted:true');
      assert.ok(['model-authored', 'repository-prose'].includes(leaf.provenance), 'provenance is the closed pair');
      assert.equal(typeof leaf.sourceRef, 'string', 'every prose leaf carries its sourceRef');
    }
  }
  const packDigest = results[0].payload?.packDigest ?? null;
  assert.equal(typeof packDigest, 'string', 'the answer exposes its pack citation');
  const delivered = adapter.calls.prompt.filter((call) => {
    const content = JSON.stringify(call.content ?? '');
    return content.includes('UNTRUSTED') && content.includes(packDigest);
  });
  assert.ok(delivered.length >= 1,
    'the framed ANSWER — not a bare UNTRUSTED token stamped into unrelated content — reaches the provider-bound frame through the SAME renderer (only-path proof, blue-team T-3)');
});

test('OR-L3 [stage: code-lane-missing]: a cross-scope region refuses with the CONSTANT scope refusal BEFORE any module/path existence check', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ pathScope: ['lane-b'] }));
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'lane-c' } }, 'or-l3-foreign');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'lane-b/nonexistent-module' } }, 'or-l3-nonexistent');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'lane-b' } }, 'or-l3-in-scope');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 3, 'the lane answers all three queries (stage: code query kind missing)');
  const foreign = results[0].payload ?? {};
  const nonexistent = results[1].payload ?? {};
  assert.equal(foreign.ok ?? null, false, 'a module outside the attempt pathScope refuses');
  assert.equal(nonexistent.ok ?? null, false);
  const foreignCode = String(foreign.code ?? foreign.result ?? '');
  const nonexistentCode = String(nonexistent.code ?? nonexistent.result ?? '');
  assert.equal(foreignCode, nonexistentCode, 'foreign-scope and nonexistent refuse IDENTICALLY — no module-existence leak either direction');
  assert.match(foreignCode, /scope|forbidden/u, 'the constant refusal is the SCOPE refusal, applied before existence lookup');
  assert.equal(results[2].payload?.ok ?? null, true, 'an in-scope region answers (positive control)');
});

test('OR-L4 [stage: code-lane-missing]: detail descends from a live map/region citation and carries mergeAuthority:false, verificationAuthority:false', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  // An arbitrary caller-named path/range (no live citation) is a raw-file read alias — refused.
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.detail', path: 'src/secret.js', range: { start: { line: 1 }, end: { line: 40 } } }, 'or-l4-raw');
  await flush(40);
  const rawResults = readResults(coordinator, handle);
  assert.equal(rawResults.length, 1, 'the lane answers (stage: code query kind missing)');
  assert.equal(rawResults[0].payload?.ok ?? null, false, 'a citation-less caller-named path/range is refused');
  // The honest descent: map first, then detail against the live citation with a contained range.
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-l4-map');
  await flush(40);
  const mapResult = readResults(coordinator, handle).at(-1);
  assert.equal(mapResult?.payload?.ok ?? null, true, 'the live map answers (the citation source)');
  const citation = mapResult?.payload?.packDigest ?? mapResult?.payload?.citation ?? null;
  assert.equal(typeof citation, 'string', 'the map answer exposes its pack citation for descent');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 12 } } }, 'or-l4-detail');
  await flush(40);
  const detail = readResults(coordinator, handle).at(-1);
  assert.equal(detail?.payload?.ok ?? null, true, 'a detail descending from a live citation with a contained range answers');
  assert.equal(detail?.payload?.mergeAuthority ?? null, false, 'detail is evidence, never clearance (mergeAuthority:false)');
  assert.equal(detail?.payload?.verificationAuthority ?? null, false, 'detail is evidence, never clearance (verificationAuthority:false)');
});

test('OR-L5 [stage: code-lane-missing]: a region exceeding 4KiB returns needs_resume + a cursor over {packDigest, pageOffset, freshnessDigest, scopeDigest}', async () => {
  // Blue-team blocker 1: refused reads are receipted too (coordinator.mjs:11583-11587), so this
  // row requires an ok:true ANSWER and exercises the needs_resume block UNCONDITIONALLY — the
  // fixture module is 28 files x 3 exported contracts + invariants, >4KiB of honest region
  // surface under any contract-correct rendering, so the answer MUST page. The lane's answer
  // source is the Coordinator's capabilities registry (invented surface, header).
  const files = {};
  for (let i = 0; i < 28; i += 1) {
    files[`src/module-${i}.js`] = `/** Region fixture module ${i}: exported contracts and invariants for the orientation ladder.\n * Invariant: region pages stay constructively bounded; detail descends from live citations.\n */\nexport function alpha${i}(input) { return input + ${i}; }\nexport function beta${i}(input) { return input * (${i} + 1); }\nexport function gamma${i}(input) { return input - ${i}; }\n`;
  }
  const { adapter, coordinator } = orientedLane(files, 'l5');
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'src' } }, 'or-l5-region');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 1, 'exactly one read result on the worker stream (the code query kind is hub-admitted and answered)');
  const payload = results[0].payload ?? {};
  assert.equal(payload.ok ?? null, true,
    'the region ANSWERS — a receipted refusal (context_read_invalid) can never satisfy this row (stage: code query kind missing)');
  const region = payload.region ?? payload.result ?? null;
  assert.ok(region !== null && typeof region === 'object', 'the answer carries a region object');
  assert.ok(Buffer.byteLength(JSON.stringify(region)) <= 4096, 'the region tier page is constructively bounded <= 4KiB');
  assert.equal(payload.status ?? null, 'needs_resume',
    'the fixture module exceeds one page — a truncated region SAYS needs_resume unconditionally (never status:ok with a silently dropped tail)');
  assert.equal(typeof payload.cursor, 'string', 'a truncated region mints an opaque continuation cursor over {packDigest, pageOffset, freshnessDigest, scopeDigest}');
  assert.match(String(payload.packDigest ?? ''), /^(?:context-pack:)?[a-f0-9]{64}$/u, 'the page cites its pack by digest');
  assert.match(String(payload.freshnessDigest ?? ''), /^[a-f0-9]{64}$/u, 'the page carries its freshnessDigest (resume re-checks it)');
  assert.match(String(payload.scopeDigest ?? ''), /^[a-f0-9]{64}$/u, 'the page carries its scopeDigest (resume re-authorizes it)');
});

test('OR-L8 [stage: closed-union-renderer-missing]: the ONE provider renderer rejects unknown leaf fields and unframed prose at the seam', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  await coordinator.spawn('mock', makeBrief());
  // The one renderer seam (coordinator._renderContextRead — the ONLY path per its own comment,
  // coordinator.mjs:10347-10351) must enforce the O-1 closed leaf union for the code kind:
  // generated leaves carry typed structural fields only; prose leaves REQUIRE
  // {text, provenance, untrusted:true, sourceRef}; anything else is REJECTED before delivery.
  // Today the seam knows no code kind and renders any leaf under a default frame (:10352-10384).
  const malformed = [
    { source: 'generated', text: 'a generated leaf smuggling free prose', moduleDigest: '1'.repeat(64) },
    { source: 'curated', text: 'purpose prose with no untrusted flag', provenance: 'model-authored', sourceRef: 'src/a.js:1' },
    { text: 'unframed prose with no provenance at all' },
  ];
  for (const leaf of malformed) {
    assert.throws(
      () => coordinator._renderContextRead({ kind: 'code', items: [leaf] }),
      (error) => typeof (error?.code ?? error?.name) === 'string',
      `the renderer REJECTS a leaf outside the closed union at the provider seam: ${JSON.stringify(leaf).slice(0, 60)}`,
    );
  }
  const framed = coordinator._renderContextRead({
    kind: 'code',
    items: [
      { source: 'generated', moduleDigest: '1'.repeat(64), symbols: ['alpha'] },
      { text: 'module purpose', provenance: 'model-authored', untrusted: true, sourceRef: 'kg:finding:1' },
    ],
  });
  assert.ok(JSON.stringify(framed).includes('UNTRUSTED'),
    'well-formed closed-union leaves render through the ONE framed path (positive control — a reject-everything renderer fails here)');
});

test('OR-L9 [stage: range-containment-missing]: detail proves the requested range is contained in the citation\'s admitted scope — an out-of-citation range refuses BEFORE serving', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-l9-map');
  await flush(40);
  const mapResult = readResults(coordinator, handle).at(-1);
  assert.equal(mapResult?.payload?.ok ?? null, true, 'the live map answers (the citation source; stage: code query kind missing)');
  const citation = mapResult?.payload?.packDigest ?? mapResult?.payload?.citation ?? null;
  assert.equal(typeof citation, 'string', 'the map answer exposes its pack citation for descent');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 999990 }, end: { line: 1000000 } } }, 'or-l9-outside');
  await flush(40);
  const outside = readResults(coordinator, handle).at(-1);
  assert.equal(outside?.payload?.ok ?? null, false,
    'a range OUTSIDE the citation\'s admitted scope refuses — detail is never a probe past the disclosed region');
  const outsideCode = String(outside?.payload?.code ?? outside?.payload?.result ?? '');
  assert.match(outsideCode, /scope|forbidden|containment/u,
    'the containment refusal is the constant scope family, applied before any byte is served');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 12 } } }, 'or-l9-inside');
  await flush(40);
  const inside = readResults(coordinator, handle).at(-1);
  assert.equal(inside?.payload?.ok ?? null, true,
    'positive control: a contained range descends and answers (an always-refuse implementation fails here)');
});

test('OR-L10 [stage: modulekey-derivation-missing]: moduleKey rootPath derives as the deepest supported package root, else the first path segment, else .', async () => {
  const { adapter, coordinator } = orientedLane({
    'packages/alpha/package.json': '{"name":"alpha","version":"0.0.0"}\n',
    'packages/alpha/src/a.js': 'export const a = 1\n',
    'src/util/b.js': 'export const b = 2\n',
    'root.js': 'export const root = 3\n',
  }, 'l10');
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-l10-map');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 1, 'the map answers (stage: code query kind missing)');
  assert.equal(results[0].payload?.ok ?? null, true, 'the map ANSWERS — a receipted refusal never satisfies this row');
  const modules = results[0].payload?.map?.modules ?? [];
  const rootPaths = modules.map((module) => module?.moduleKey?.rootPath ?? module?.rootPath ?? null);
  assert.ok(rootPaths.includes('packages/alpha'),
    'a file under a package manifest rolls to the DEEPEST supported package root, never its parent segment');
  assert.ok(rootPaths.includes('src'), 'a file with no supported manifest rolls to its first path segment');
  assert.ok(rootPaths.includes('.'), 'a root file rolls to .');
  assert.equal(rootPaths.includes('packages'), false, 'the parent of a package root is never itself a module');
});

// ===========================================================================
// O-2/O-7 lane legs — evidence minting and the rating lane (stage: the context.read class is
// LANDED but the code-lane mint + contract identity tuple, and the orientation.rating_recorded
// lane, do not exist; today the refused code query returns before the mint block,
// coordinator.mjs:10262-10279).
// ===========================================================================

test('OR-L6 [stage: code-lane-mint-missing]: an orientation materialization mints exactly ONE context.read per identity tuple — never scratch.read, replay mints nothing', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const query = { kind: 'code', op: 'code.orient.map' };
  emitCodeRead(adapter, handle, query, 'or-l6-read');
  await flush(40);
  const reads = coordinator._coordination.events().filter((event) => event.kind === 'context.read');
  assert.equal(reads.length, 1, 'a successful orientation materialization appends at most one context.read per hub-derived identity tuple');
  const minted = reads[0].payload ?? {};
  for (const key of ['repoId', 'runId', 'taskId', 'taskVersion', 'workerId', 'op', 'normalizedQueryDigest', 'packDigest', 'freshnessDigest']) {
    assert.notEqual(minted[key], undefined,
      `the minted context.read carries the contract identity tuple.${key} (O-2) — not the landed BD3-A interim shape {kind, queryDigest, resultDigest} (coordinator.mjs:10267-10273, blue-team T-15)`);
  }
  assert.equal(coordinator._coordination.events().some((event) => event.kind === 'scratch.read'), false,
    'orientation evidence is the context.read class, NEVER the scratch.read family');
  emitCodeRead(adapter, handle, query, 'or-l6-read');
  await flush(40);
  assert.equal(coordinator._coordination.events().filter((event) => event.kind === 'context.read').length, 1,
    'exact replay returns the prior event — no second append');
});

test('OR-L7 [stage: rating-lane-missing]: a worker rates a pack it received; unknown digests draw the constant orientation_rating_refused; a missed rating never gates serving', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const query = { kind: 'code', op: 'code.orient.map' };
  emitCodeRead(adapter, handle, query, 'or-l7-read');
  await flush(40);
  const received = readResults(coordinator, handle).at(-1);
  assert.equal(received?.payload?.ok ?? null, true, 'the worker received a pack (stage: code query kind missing)');
  const packDigest = received?.payload?.packDigest ?? null;
  assert.equal(typeof packDigest, 'string');
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'orientation.rate', actor: 'worker',
    payload: { packDigest, rating: 'useful', idempotencyKey: 'or-l7-rate' },
  });
  await flush(40);
  const ratings = coordinator._coordination.events().filter((event) => event.kind === 'orientation.rating_recorded');
  assert.equal(ratings.length, 1, 'the hub mints the dedicated closed rating event (not a free-form scratchpad kind)');
  const payload = ratings[0].payload ?? {};
  for (const key of ['repoId', 'runId', 'taskId', 'taskVersion', 'workerId', 'packDigest', 'grantOrReadEventSeq', 'rating']) {
    assert.notEqual(payload[key], undefined, `rating payload.${key} is hub-derived`);
  }
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'orientation.rate', actor: 'worker',
    payload: { packDigest: '0'.repeat(64), rating: 'missed', idempotencyKey: 'or-l7-unknown' },
  });
  await flush(40);
  const refusal = coordinator._log.read(handle.id).find((event) => JSON.stringify(event.payload ?? {}).includes('orientation_rating_refused'));
  assert.ok(refusal, 'an unknown/invisible pack draws the ONE constant orientation_rating_refused');
  emitCodeRead(adapter, handle, query, 'or-l7-reread');
  await flush(40);
  const reread = readResults(coordinator, handle).at(-1);
  assert.equal(reread?.payload?.ok ?? null, true, 'a missed rating never vetoes the pack — aggregates are advisory, never serving gates');
});

// ===========================================================================
// O-3 — freshness over the EXISTING ATLAS plane (stage: no git-base authority —
// index.build attests no baseTreeSha, serve compares nothing, resume serves
// stored bytes verbatim). Driver harness over a real git repo.
// ===========================================================================

test('OR-F1 [stage: base-attestation-missing]: index.build persists {repoId, baseTreeSha, indexEpoch, baseInputsDigest} as ONE attested record', async (t) => {
  const root = repo('f1', { 'src/a.js': 'export const a = 1\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const treeSha = git(root, ['rev-parse', 'HEAD^{tree}']);
  assert.equal(built.provenance?.baseTreeSha, treeSha,
    'the base MUST be read from the deployment immutable git object tree and attested (today: only index_epoch + base_inputs_digest, no treeSha anchor)');
  assert.equal(built.provenance?.repoId, 'orientation-contract-repo', 'the attestation record carries the repoId');
  assert.match(String(built.provenance?.indexEpoch ?? built.provenance?.index_epoch ?? ''), /^[a-f0-9]{64}$/u, 'indexEpoch present');
  assert.match(String(built.provenance?.baseInputsDigest ?? built.provenance?.base_inputs_digest ?? ''), /^[a-f0-9]{64}$/u, 'baseInputsDigest present');
  // T-9 teeth: the base MUST be read from the immutable git object tree, not the mutable
  // directory — a dirty (never-committed) worktree must not move the attested tree — and the
  // record PERSISTS as one unit, riding later answers at the epoch (a recompute-per-query stub
  // that never attests the record fails here; composition with OR-F2 proves persistence).
  write(root, 'src/a.js', 'export const a = 999 // dirty, never committed\n');
  const rebuilt = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  assert.equal(rebuilt.provenance?.baseTreeSha, treeSha,
    'a dirty worktree never moves the base attestation — the base bytes come from the git object tree, not the mutable directory');
  const served = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: built.provenance.index_epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  const record = served.provenance ?? {};
  assert.equal(record.baseTreeSha ?? record.base_tree_sha ?? null, treeSha,
    'the attested {repoId, baseTreeSha, indexEpoch, baseInputsDigest} record persists as ONE unit and rides every answer at the epoch');
  assert.equal(record.repoId ?? null, 'orientation-contract-repo', 'the persisted record carries the repoId');
});

test('OR-F2 [stage: stale-base-gate-missing]: serve refuses orientation_base_stale when the base tree moved under a cached epoch', async (t) => {
  const root = repo('f2', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const fresh = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal(fresh.status, 'ok', 'a query at the pinned base serves (positive control)');
  write(root, 'src/c.js', 'export const c = 3\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'move the base tree']);
  const refusal = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root })
    .then(() => null, (error) => error?.code ?? 'thrown');
  assert.equal(refusal, 'orientation_base_stale',
    'a moved base tree refuses — the worktree-only overlay can never catch a base/HEAD divergence (stale structure is NEVER served as fresh)');
});

test('OR-F3 [stage: resume-freshness-missing]: resume is a serve path — resuming after a tree move refuses, never serves the cached slice', async (t) => {
  const root = repo('f3', {
    'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n',
    'src/c.js': 'export const c = 3\n', 'src/d.js': 'export const d = 4\n',
  });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const page = await composed.coordinator.invokeCapability('cartographer', 'orientation.slice', { indexEpoch: epoch, focus: 'src', shape: 'map' }, { budgetTokens: 60, worktreeRoot: root });
  assert.equal(page.status, 'needs_resume', 'control: a bounded page mints a cursor');
  const control = await composed.coordinator.resumeCapability('cartographer', 'orientation.slice', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root });
  assert.ok(['ok', 'needs_resume'].includes(control.status), 'control: resume at the pinned tree serves');
  write(root, 'src/e.js', 'export const e = 5\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'move the tree']);
  const refusal = await composed.coordinator.resumeCapability('cartographer', 'orientation.slice', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root })
    .then(() => null, (error) => error?.code ?? 'thrown');
  assert.ok(refusal === 'effective_tree_changed' || refusal === 'orientation_base_stale',
    `resume re-checks the full freshnessDigest and refuses on divergence (today resume serves stored bytes verbatim; observed: ${refusal === null ? 'served' : refusal})`);
});

test('OR-F4 [stage: reverify-freshness-missing]: reverify is a serve path — re-verifying after the base tree moved refuses, never a bare digest-mismatch report', async (t) => {
  const root = repo('f4', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const fresh = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal(fresh.status, 'ok', 'control: a query at the pinned base serves');
  const clean = await composed.coordinator.reverifyCapability('atlas-index', 'repo.map', fresh, { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal(clean.status, 'ok', 'control: reverify at the pinned base re-runs');
  assert.equal(clean.payload?.[0]?.ok ?? null, true, 'control: a clean reverify confirms the claim — the reverify machinery itself is live in this fixture');
  write(root, 'src/c.js', 'export const c = 3\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'move the base tree']);
  const refusal = await composed.coordinator.reverifyCapability('atlas-index', 'repo.map', fresh, { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root })
    .then(() => null, (error) => error?.code ?? 'thrown');
  assert.ok(refusal === 'orientation_base_stale' || refusal === 'effective_tree_changed',
    `Serve, reverify, and resume ALL re-derive the freshness authority — reverify after a tree move refuses (today: rerun-and-compare-digest returns a bare ok:false payload, atlas-index.mjs:395-406; observed: ${refusal === null ? 'served' : refusal})`);
});

// ===========================================================================
// O-5 — citation vs continuation vs grant, over the EXISTING cursor machinery
// (stage: bearer-only resume, host-path refs, unknown_cursor on reclaimed bytes,
// no deployment storage ceiling). Two pins hold the behavior the contract keeps.
// ===========================================================================

test('OR-C1 [stage: cursor-authority-missing]: a cursor copied across attempts fails AUTHORIZATION with the constant scope refusal, BEFORE artifact existence lookup', async (t) => {
  const root = repo('c1', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n', 'src/c.js': 'export const c = 3\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const overlayA = tmpDir('overlay-a');
  execFileSync('cp', ['-R', `${root}/.`, overlayA]);
  const overlayB = tmpDir('overlay-b');
  execFileSync('cp', ['-R', `${root}/.`, overlayB]);
  // T-11: overlayB is BYTE-IDENTICAL to overlayA (a pure copy at another path) — freshness is
  // equal, so a refusal on the copied cursor can only be authorization, never a freshness
  // refusal mislabeled as a scope refusal.
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: overlayA });
  assert.equal(page.status, 'needs_resume', 'control: attempt A mints a cursor');
  const sameScope = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: overlayA })
    .then(() => 'served', (error) => error?.code ?? 'thrown');
  assert.equal(sameScope, 'served',
    'positive control: a resume inside the SAME attempt scope serves — an always-refuse implementation fails here (blue-team T-11)');
  const copied = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: overlayB })
    .then(() => 'served', (error) => error?.code ?? 'thrown');
  assert.match(String(copied), /scope|forbidden/u,
    'a valid cursor copied to another attempt\'s scope conveys NO authority (today resume is bearer-only: it serves)');
  const ghost = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', {
    kind: 'atlas_results', handle: `art:sha256:${'0'.repeat(64)}`, digest: '0'.repeat(64), bytes: 1,
    mediaType: 'application/vnd.baton.atlas-index+json',
  }, `atlas:${'0'.repeat(64)}:0`, { budgetTokens: 5_000, worktreeRoot: overlayB })
    .then(() => 'served', (error) => error?.code ?? 'thrown');
  assert.equal(ghost, copied, 'unknown-artifact and out-of-scope refuse IDENTICALLY — scope refusal precedes existence lookup');
});

test('OR-C2 [stage: path-disclosure]: worker-visible refs carry only {kind, handle, digest, bytes, mediaType} — host paths are internal-only', async (t) => {
  const root = repo('c2', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n', 'src/c.js': 'export const c = 3\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: root });
  assert.equal(page.status, 'needs_resume', 'control: a bounded page mints a cursor');
  const resumed = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root });
  for (const ref of [...page.refs, ...resumed.refs]) {
    assert.deepEqual(Object.keys(ref).sort(), ['bytes', 'digest', 'handle', 'kind', 'mediaType'],
      'the transport projection strips local paths (today both planes return the absolute artifact path)');
    assert.equal(JSON.stringify(ref).includes(root), false, 'no host filesystem topology leaks to workers');
  }
});

test('OR-C3 (pin) [pagination-honesty]: a truncated page says needs_resume with a cursor; resume completes deterministically and losslessly', async (t) => {
  const root = repo('c3', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n', 'src/c.js': 'export const c = 3\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const full = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal(full.status, 'ok', 'control: the unbounded page serves');
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: root });
  assert.equal(page.status, 'needs_resume', 'a truncated page SAYS so — the tail is never dropped silently (contract-kept behavior)');
  assert.match(String(page.cursor ?? ''), /^atlas:[a-f0-9]{64}:\d+$/u, 'the cursor is content-addressed and offset-bearing');
  const resumed = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal(resumed.status, 'ok');
  assert.deepEqual([...page.payload, ...resumed.payload], full.payload, 'pages are budget-bounded, deterministic, and lossless');
});

test('OR-C4 (pin) [digest-verified-loads]: forged handle/cursor pairings and tampered artifact bytes fail integrity', async (t) => {
  const root = repo('c4', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n', 'src/c.js': 'export const c = 3\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: root });
  assert.equal(page.status, 'needs_resume', 'control: a bounded page mints a cursor');
  const forged = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', {
    kind: 'atlas_results', handle: `art:sha256:${'0'.repeat(64)}`, digest: '0'.repeat(64), bytes: 1,
    mediaType: 'application/vnd.baton.atlas-index+json',
  }, page.cursor, { budgetTokens: 5_000, worktreeRoot: root }).then(() => null, (error) => error?.code ?? 'thrown');
  assert.equal(forged, 'invalid_cursor', 'a forged digest fails the handle/cursor integrity check (contract-kept behavior)');
  // Blocker 5: tamper through the fixture's own artifact root + the ref DIGEST (a field that
  // survives OR-C2's transport stripping), never the worker-visible ref.path key.
  writeFileSync(atlasArtifactPath(root, page.refs[0]), '{"tampered":true}\n');
  const tampered = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root })
    .then(() => null, (error) => error?.code ?? 'thrown');
  assert.equal(tampered, 'result_integrity', 'artifact loads are digest-verified — tampered bytes refuse (contract-kept behavior)');
});

test('OR-C5 [stage: retirement-honesty-missing]: a lawfully reclaimed page returns orientation_artifact_retired — never unknown_cursor, never an empty or regenerated page', async (t) => {
  const root = repo('c5', { 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 2\n', 'src/c.js': 'export const c = 3\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const epoch = built.provenance.index_epoch;
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: root });
  assert.equal(page.status, 'needs_resume', 'control: a bounded page mints a cursor');
  rmSync(atlasArtifactPath(root, page.refs[0])); // stands in for lawful reachability reclamation under the O-5 ceiling (digest-derived path, never the stripped ref.path — blocker 5)
  const refusal = await composed.coordinator.resumeCapability('atlas-index', 'repo.map', page.refs[0], page.cursor, { budgetTokens: 5_000, worktreeRoot: root })
    .then(() => null, (error) => error?.code ?? 'thrown');
  assert.equal(refusal, 'orientation_artifact_retired',
    'reclaimed pages are honestly retired (today: unknown_cursor — there is no retention contract at all)');
});

test('OR-C6 [stage: storage-ceiling-missing]: orientation storage refuses BEFORE write with orientation_storage_exhausted past the deployment byte ceiling', async () => {
  const root = repo('c6', { 'src/a.js': 'export const alpha = 1\nexport const beta = 2\n' });
  // The deployment-wide byte ceiling knob (maxOrientationStorageBytes) is the O-5 constructive
  // control this epic adds; today no quota, roots, or reclamation exist at all.
  const index = new AtlasCodeIndex({
    artifactRoot: join(tmpDir('c6-artifacts'), 'atlas'), maxArtifactBytes: 256 * 1024,
    maxSourceBytes: 64 * 1024, maxFiles: 64, maxResults: 256, maxOrientationStorageBytes: 600,
  });
  const built = await index.invoke('index.build', {}, { budgetTokens: 10_000, baseRoot: root });
  const epoch = built.provenance.index_epoch;
  // T-12: positive control first — writes BELOW the ceiling MUST succeed, so a hair-trigger
  // refuse-everything implementation fails here; the refusal may only fire once the ceiling is
  // actually crossed.
  const first = await index.invoke('search.lexical', { indexEpoch: epoch, query: 'orientation-ceiling-probe-0' }, { budgetTokens: 2_000, baseRoot: root, worktreeRoot: root })
    .then(() => 'admitted', (error) => error?.code ?? 'thrown');
  assert.equal(first, 'admitted', 'positive control: writes below the ceiling succeed (blue-team T-12)');
  let refusal = null; let admitted = 1;
  for (let i = 1; i < 12 && refusal === null; i += 1) {
    refusal = await index.invoke('search.lexical', { indexEpoch: epoch, query: `orientation-ceiling-probe-${i}` }, { budgetTokens: 2_000, baseRoot: root, worktreeRoot: root })
      .then(() => { admitted += 1; return null; }, (error) => error?.code ?? 'thrown');
  }
  assert.equal(refusal, 'orientation_storage_exhausted',
    'past the deployment byte ceiling the next write refuses BEFORE append (today: create-if-absent CAS writes are unbounded)');
  assert.ok(admitted >= 1, 'the ceiling refuses only once it is actually crossed, never up-front');
});

// ===========================================================================
// O-6 — spawn-time L0 (stage: L0 injection + the pack-grant event kind absent; the BD3-B pack
// machinery + spawn head-CAS are LANDED — context_pack_stale at coordinator.mjs:3568, :4139).
// OR-S3 pins the campaign law scoped to orientation identifiers: no clock on this epic's surface.
// ===========================================================================

test('OR-S1 [stage: l0-injection-missing]: EVERY spawn brief carries the pathScope-scoped L0 map as a cited, framed context-pack — never spliced into the objective', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ pathScope: ['lane-b'] }));
  const brief = adapter.calls.spawn.at(-1)?.brief ?? {};
  const text = JSON.stringify(brief);
  assert.match(text, /context-pack:[a-f0-9]{64}|packDigest/u,
    'O-6: the L0 map is injected into EVERY brief at spawn as a context-pack citation (stage: L0 injection missing)');
  assert.ok(text.includes('UNTRUSTED'), 'the materialized L0 map arrives framed under the O-1 closed leaf union, never raw instructions');
  assert.equal(typeof brief.goal, 'string');
  assert.ok(!brief.goal.includes('context-pack:'), 'the pack is CITED by digest, never spliced into the objective string');
  assert.equal(JSON.stringify(brief.constraints ?? []).includes('context-pack:'), false,
    'nor spliced into the constraints (blue-team T-13: the splice guard covers more than brief.goal)');
  const grant = brief.orientation ?? brief.contextPacks ?? brief.packs ?? null;
  assert.ok(grant !== null, 'the brief carries the L0 orientation grant');
  assert.ok(JSON.stringify(grant).includes('lane-b'),
    'the L0 map is scoped TO the worker\'s own lane — a repo-global or wrong-region map that never mentions lane-b fails here (blue-team T-13)');
  assert.equal(JSON.stringify(grant).includes('lane-c'), false,
    'the L0 map is scoped to the worker\'s hub-derived pathScope — a lane-B worker never receives another lane\'s map');
  void handle;
});

test('OR-S2 [stage: pack-grant-kind-missing]: a spawn-time non-head L0 citation fails context_pack_stale; the live head spawns; a retried spawn exact-replays and never mints a second grant', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const store = coordinator._coordination;
  const first = store.mintContextPack({ type: 'orientation-map', body: 'L0 map v1' }, { actor: 'orchestrator', key: 'or-s2-v1' });
  store.mintContextPack({ type: 'orientation-map', body: 'L0 map v2', predecessor: first.pack.packId }, { actor: 'orchestrator', key: 'or-s2-v2' });
  const refusal = await coordinator.spawn('mock', makeBrief({ contextPacks: [first.pack.packId] })).then(
    () => null,
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(refusal, 'context_pack_stale',
    'a non-head citation fails loudly at spawn (causal supersession — NEVER a wall-clock expiry)');
  const headId = store.contextPackHead('orientation-map').packId;
  const brief = makeBrief({ contextPacks: [headId] });
  const handle = await coordinator.spawn('mock', brief).then(
    (spawned) => spawned,
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(typeof handle, 'object', 'the live head cites and spawns (positive control)');
  // Blue-team blocker 3: the grant oracle is REAL — the invented context.pack_granted event
  // (header) is counted for the attempt AFTER the retry, and the retry outcome is exact
  // (=== 'spawned' same-attempt replay). Today NO grant event kind exists anywhere in
  // impl/src (grep: 0 hits) and spawn has no retry identity (duplicate taskId throws
  // DuplicateTaskIdError, coordinator.mjs:3998) — both are the named red stage.
  const grantsFor = (taskId) => store.events().filter((event) => event.kind === 'context.pack_granted' && event.payload?.taskId === taskId);
  const grantsBeforeRetry = grantsFor(handle.taskId);
  assert.equal(grantsBeforeRetry.length, 1, 'a cited spawn mints exactly ONE attempt-scoped pack grant');
  for (const key of ['packId', 'runId', 'taskId', 'taskVersion', 'workerId']) {
    assert.notEqual(grantsBeforeRetry[0]?.payload?.[key], undefined, `the grant payload.${key} is hub-derived and attempt-scoped`);
  }
  assert.equal(grantsBeforeRetry[0]?.payload?.packId, headId, 'the grant cites the live head pack');
  const retry = await coordinator.spawn('mock', brief, { taskId: handle.taskId }).then(
    () => 'spawned',
    (error) => error?.code ?? error?.name ?? 'thrown',
  );
  assert.equal(retry, 'spawned',
    'a retried spawn of the SAME attempt with the SAME brief exact-replays the binding (O-6: append-or-exact-replay; same-key/different-content is the only refusal class)');
  assert.equal(grantsFor(handle.taskId).length, 1,
    'grants stay attempt-scoped: counted AFTER the retry, exactly one — a retried spawn never mints a second grant for the same attempt');
  assert.equal(store.events().filter((event) => event.kind === 'context.pack_granted').length, 1,
    'the refused non-head spawn minted NO grant (refusal precedes any grant side effect)');
});

test('OR-S3 (pin) [campaign-law]: orientation packs invalidate CAUSALLY only — no clock/TTL parameter on any orientation-surface symbol (BD3-B spine compatible)', () => {
  // Blue-team blocker 2: BD3-B legitimately landed its own contract-adopted wall-clock window
  // (materializeContextPack throws context_pack_expired at coordination-store.mjs:12977 under
  // DEFAULT_CONTEXT_PACK_VALIDITY :445 — bidirectional-v3-decisions.md:48-49), so a grep for
  // the shared context_pack vocabulary can never green under a contract-correct stack. The v1.0
  // fold forbids the clock on THIS epic's orientation surface, NOT in the spine. This pin is
  // therefore scoped to orientation-specific identifiers: no CODE line (comments excluded)
  // carrying an orientation symbol may carry clock/TTL vocabulary — vacuously green today (no
  // orientation surface exists), red the moment an implementation puts a validity/TTL/expiry
  // parameter or a clock read on any of them.
  const orientationIdentifiers = [
    'code.orient', 'orientation-map', 'orientation-region', 'orientation-detail',
    'mintOrientationSource', 'recordOrientationRating', 'proposeOrientationCandidate', 'mergeOrientationMap',
    'orientationReceiptCeilings', 'maxOrientationStorageBytes',
    'orientation.rating_recorded', 'orientation.leaf_proposed', 'orientation.overlay_proposed',
    'context.pack_granted', 'normalizedQueryDigest', 'freshnessDigest',
    'overlayOmissions', 'overlay_dangling', 'overlay_conflict',
    'orientation_unavailable', 'orientation_base_stale', 'orientation_artifact_retired',
    'orientation_storage_exhausted', 'orientation_rating_refused', 'orientation_rating_conflict',
    'orientation_receipt_ceiling', 'orientation_propose_refused',
  ];
  const clockVocabulary = /validity\s*:|ttl\s*:|expiresAt|context_pack_expired|Date\.now\(|Date\.parse\(|\bnow\(\)|setTimeout\(|setInterval\(/u;
  const srcDir = join(import.meta.dirname, '..', 'src');
  for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.mjs'))) {
    const lines = readFileSync(join(srcDir, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
      const codeOnly = line.replace(/\/\/.*$/u, '');
      if (!orientationIdentifiers.some((identifier) => codeOnly.includes(identifier))) return;
      assert.equal(clockVocabulary.test(codeOnly), false,
        `${file}:${index + 1}: an orientation-surface symbol carries clock/TTL vocabulary — orientation packs invalidate causally only (supersession context_pack_stale, tree/overlay divergence, scope/attempt closure, operator retirement, O-5 storage reclamation)`);
    });
  }
});

test('OR-S4 [stage: grant-ordering-missing]: artifact-write → atomic grant+spawn append → provider dispatch; two attempts share pack bytes but hold attempt-scoped grants', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const store = coordinator._coordination;
  store.mintContextPack({ type: 'orientation-map', body: 'L0 map' }, { actor: 'orchestrator', key: 'or-s4-v1' });
  const headId = store.contextPackHead('orientation-map').packId;
  // Ordering oracle (O-6): at PROVIDER DISPATCH the grant+binding must already be durable —
  // write the artifact, atomically append grant+spawn, ONLY THEN dispatch. The adapter probes
  // the coordination store synchronously from inside spawn(); a dispatch-before-grant
  // implementation records a zero here.
  const grantsAtDispatch = [];
  adapter.spawn = async (worker, brief) => {
    adapter.calls.spawn.push({ worker, brief });
    grantsAtDispatch.push(store.events().filter((event) => event.kind === 'context.pack_granted').length);
    return { ok: true };
  };
  const first = await coordinator.spawn('mock', makeBrief({ contextPacks: [headId] }));
  const second = await coordinator.spawn('mock', makeBrief({ contextPacks: [headId] }));
  assert.ok(grantsAtDispatch.length === 2 && grantsAtDispatch.every((count) => count >= 1),
    'the pack grant is appended BEFORE the provider dispatch — a crash after append exact-replays, a dispatch never precedes its grant');
  const grants = store.events().filter((event) => event.kind === 'context.pack_granted');
  assert.equal(grants.length, 2, 'two attempts citing the same live head hold TWO attempt-scoped grants (authority never collapses across attempts)');
  const grantedTaskIds = grants.map((event) => event.payload?.taskId).sort();
  assert.deepEqual(grantedTaskIds, [first.taskId, second.taskId].sort(), 'grants are attempt-scoped');
  assert.ok(grants.every((event) => event.payload?.packId === headId),
    'both grants cite the SAME pack — pack bytes dedup by digest across workers in one region');
});

// ===========================================================================
// O-2/O-4 — evidence class, compounding, and the curated overlay (stage:
// orientation.candidate.propose / overlay / per-attempt ceiling machinery absent; the
// context.read class itself is LANDED — coordination-store.mjs:12994-13006, projected at
// :8596-8599 with the zero-weight comment; the workflow admission trigger vocabulary is
// unamended). Pure-store harness.
// ===========================================================================

test('OR-E1 [stage: context-read-class-missing]: orientation reads mint ZERO-promotion-weight context.read — minScratchReaders never counts them', () => {
  const store = makeStore('e1');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  store.postScratchFact({
    namespace: 'tests', key: 'fact:weight', value: 'observed fact', grounding: 'observed',
    envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, ownerTask: 'a',
  }, { actor: 'w-a', key: 'scratch:weight' });
  // Positive control (EXISTING behavior): an independent scratch.read reader derives the candidate.
  store.readScratch('fact:weight', { repoId: 'repo-a', treeSha: 'cafe1234' },
    { readerActor: 'worker', readerWorker: 'w-b', taskId: 'b' }, { actor: 'worker:b', key: 'read:weight' });
  const control = store.promoteKnowledgeBatch('repo-a', store.snapshot().lastSeq, promotionPolicy(), { actor: 'orchestrator', key: 'or-e1-control' });
  assert.ok((control.projection?.summaries ?? []).some((row) => row.trigger === 'scratch.cited_observed'),
    'control: scratch.read accrues promotion weight (the existing class) — the promotion path is live in this fixture');
  // The contract class: orientation reads mint context.read, ZERO weight (stage: the class does not exist).
  const read = store.recordContextRead({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.map', normalizedQueryDigest: digest({ op: 'code.orient.map' }),
    packDigest: '1'.repeat(64), freshnessDigest: '2'.repeat(64),
  }, { actor: 'worker:w-b', key: 'or-e1-cr' });
  assert.ok((read?.event?.seq ?? 0) >= 1, 'the orientation materialization mints a context.read event');
  store.postScratchFact({
    namespace: 'tests', key: 'fact:orientation-only', value: 'never promoted by orientation reads', grounding: 'observed',
    envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, ownerTask: 'a',
  }, { actor: 'w-a', key: 'scratch:orient-only' });
  store.recordContextRead({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.detail', normalizedQueryDigest: digest({ fact: 'fact:orientation-only' }),
    packDigest: '3'.repeat(64), freshnessDigest: '2'.repeat(64),
  }, { actor: 'worker:w-b', key: 'or-e1-cr2' });
  const second = store.promoteKnowledgeBatch('repo-a', store.snapshot().lastSeq, promotionPolicy(), { actor: 'orchestrator', key: 'or-e1-second' });
  const derived = (second.projection?.summaries ?? []).filter((row) => row.trigger === 'scratch.cited_observed');
  assert.ok(derived.every((row) => !JSON.stringify(row).includes('orientation-only')),
    'context.read NEVER satisfies the reader threshold — there is no weight to farm');
});

test('OR-E2 [stage: context-read-class-missing]: context.read replay is hub-derived — exact replay returns the prior event; same-key/different-content refuses context_read_conflict', () => {
  const store = makeStore('e2');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const tuple = {
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.map', normalizedQueryDigest: digest({ op: 'code.orient.map', moduleKey: 'lane-b' }),
    packDigest: '1'.repeat(64), freshnessDigest: '2'.repeat(64),
  };
  const first = store.recordContextRead(tuple, { actor: 'worker:w-b', key: 'or-e2-read' });
  const before = store.snapshot().lastSeq;
  const replay = store.recordContextRead(tuple, { actor: 'worker:w-b', key: 'or-e2-read' });
  assert.equal(store.snapshot().lastSeq, before, 'exact replay appends nothing');
  assert.equal((replay?.event ?? replay)?.seq, (first?.event ?? first)?.seq, 'exact replay returns the prior event');
  const conflict = refusalCode(() => store.recordContextRead({ ...tuple, packDigest: '9'.repeat(64) }, { actor: 'worker:w-b', key: 'or-e2-read' }));
  assert.equal(conflict, 'context_read_conflict',
    'same-key/different-content refuses (the shipped readKnowledge request-digest pattern)');
});

test('OR-E3 [stage: receipt-ceiling-missing]: per-attempt receipt count/byte ceilings refuse BEFORE append — writes never continue past the ceiling', () => {
  // The per-attempt ceiling knobs are the O-2 constructive flood control this epic adds
  // (the red team confirmed maxScanEvents is a scan ceiling, NOT a write bound).
  const store = makeStore('e3', { orientationReceiptCeilings: { maxReceiptsPerAttempt: 2, maxReceiptBytesPerAttempt: 4096, maxProposalsPerAttempt: 2 } });
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const tuple = (n) => ({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.map', normalizedQueryDigest: digest({ op: 'code.orient.map', n }),
    packDigest: `${n}`.padEnd(64, '0'), freshnessDigest: '2'.repeat(64),
  });
  store.recordContextRead(tuple(1), { actor: 'worker:w-b', key: 'or-e3-r1' });
  store.recordContextRead(tuple(2), { actor: 'worker:w-b', key: 'or-e3-r2' });
  const before = store.snapshot().lastSeq;
  const refusal = refusalCode(() => store.recordContextRead(tuple(3), { actor: 'worker:w-b', key: 'or-e3-r3' }));
  assert.equal(refusal, 'orientation_receipt_ceiling',
    'the per-attempt count ceiling refuses with the invented typed code (header) BEFORE append — an arbitrary error name never passes (blue-team T-16)');
  assert.equal(store.snapshot().lastSeq, before, 'no event is appended past the ceiling');
  assert.equal(store.events().filter((event) => event.kind === 'context.read').length, 2, 'the admitted receipts survive intact');
});

test('OR-E4 [stage: admission-vocabulary-unamended]: orientation.leaf_proposed admits through the orchestrator/operator gate ONLY — worker self-admission refuses', () => {
  const f = admissionFixture('e4');
  // Control 1 (EXISTING): a board.item_closed candidate admits through the real gate.
  f.store.admitWorkflowFinding('repo-a', f.runId, f.candidateFindingId, workflowAdmissionPolicy, { actor: 'orchestrator', key: 'or-e4-board' }, f.lease);
  // The orientation candidate: an observed Finding with the contract's new trigger.
  f.store.addKnowledgeNode({
    id: 'finding:orientation-leaf-1', type: 'Finding', grounding: 'observed',
    body: 'module lane-b exports the fence table', evidence: [{ coordinationSeq: 1 }],
    promotion: { kind: 'Finding', trigger: 'orientation.leaf_proposed' },
  }, { actor: 'policy', key: 'or-e4-candidate' });
  // Control 2 (EXISTING authority pin): a worker actor can never admit anything.
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding('repo-a', f.runId, 'finding:orientation-leaf-1', workflowAdmissionPolicy, { actor: 'worker', key: 'or-e4-worker' }, f.lease)),
    'workflow_admit_invalid', 'only orchestrator/operator may admit (the authority gate holds)',
  );
  // The contract amendment: the orientation.leaf_proposed trigger admits under the SAME gate.
  const refusal = refusalCode(() => f.store.admitWorkflowFinding('repo-a', f.runId, 'finding:orientation-leaf-1', workflowAdmissionPolicy, { actor: 'orchestrator', key: 'or-e4-orient' }, f.lease));
  assert.equal(refusal, null,
    'the orientation.leaf_proposed trigger admits through the orchestrator/operator gate (today the closed vocabulary rejects it: workflow_admit_ineligible)');
});

test('OR-E5 [stage: overlay-machinery-missing]: the producer mints a KG Source per module coordinate; overlay candidates Cite it; stale leaves omit overlay_dangling and the map serves partial', () => {
  const store = makeStore('e5');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const moduleKey = { repoId: 'repo-a', rootPath: 'lane-b' };
  const source = store.mintOrientationSource({
    repoId: 'repo-a', moduleKey, moduleDigest: '1'.repeat(64), freshnessDigest: '2'.repeat(64),
  }, { actor: 'orchestrator', key: 'or-e5-source' });
  assert.equal(source?.node?.type, 'Source', 'a hub-derived KG Source node per {repoId, moduleKey, moduleDigest, freshnessDigest}');
  const candidate = store.proposeOrientationCandidate(
    { packDigest: '3'.repeat(64), leafDigest: '4'.repeat(64) },
    { actor: 'worker:w-b', key: 'or-e5-propose' },
  );
  assert.equal(candidate?.node?.grounding, 'observed', 'the candidate is hub-minted observed — callers supply only {packDigest, leafDigest}');
  assert.equal(candidate?.node?.promotion?.trigger, 'orientation.overlay_proposed', 'the overlay trigger is the closed contract trigger');
  const cites = store.queryKnowledgeEdges({}).filter((edge) => edge.type === 'Cites' && edge.to === (source?.node?.id ?? ''));
  assert.ok(cites.length >= 1, 'the overlay candidate carries a Cites edge to the Source (closed edge vocabulary — no new kind)');
  // Merge semantics: a curated leaf applies only on EXACT moduleDigest + freshness match.
  const merged = store.mergeOrientationMap({
    repoId: 'repo-a', moduleKey, moduleDigest: '9'.repeat(64), freshnessDigest: '8'.repeat(64),
  });
  assert.equal(merged?.status, 'partial', 'a stale curated leaf never denies the generated map — the answer serves partial');
  assert.ok((merged?.overlayOmissions ?? []).some((row) => row.reason === 'overlay_dangling'),
    'the stale leaf is omitted WITH structured trace (never silently served against the wrong module, never silently dropped)');
  const generatedModules = merged?.map?.modules ?? [];
  assert.ok(Array.isArray(generatedModules) && generatedModules.length >= 1,
    'generated structure still serves under an overlay omission — a REAL module rollup, never an empty-object error result (blue-team T-10)');
  assert.equal(generatedModules[0]?.moduleDigest, '9'.repeat(64),
    'the generated half answers for the requested module coordinate');
});

test('OR-E8 [stage: receipt-ceiling-missing]: per-attempt receipt BYTE and PROPOSAL ceilings refuse BEFORE append (OR-E3 covers the count leg)', () => {
  const store = makeStore('e8', { orientationReceiptCeilings: { maxReceiptsPerAttempt: 1000, maxReceiptBytesPerAttempt: 700, maxProposalsPerAttempt: 1 } });
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const tuple = (n) => ({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.map', normalizedQueryDigest: digest({ op: 'code.orient.map', n }),
    packDigest: `${n}`.padEnd(64, '0'), freshnessDigest: '2'.repeat(64),
  });
  // Byte leg: the count ceiling (1000) is deliberately out of reach so ONLY the byte bound can
  // fire; receipts below the ceiling admit, the crossing receipt refuses before append.
  let refusal = null; let appended = 0;
  for (let n = 1; n <= 40 && refusal === null; n += 1) {
    refusal = refusalCode(() => { store.recordContextRead(tuple(n), { actor: 'worker:w-b', key: `or-e8-b${n}` }); appended += 1; });
  }
  assert.equal(refusal, 'orientation_receipt_ceiling',
    'the per-attempt BYTE ceiling refuses with the invented typed code (header) once cumulative receipt bytes cross the bound');
  assert.ok(appended >= 1 && appended < 40,
    'receipts below the byte ceiling admit; only the crossing receipt refuses (constructive — checked BEFORE append, never up-front, never unbounded)');
  // Proposal leg: orientation.candidate.propose is bounded per attempt by the same ceiling family.
  const proposalRefusal = refusalCode(() => {
    store.proposeOrientationCandidate({ packDigest: '3'.repeat(64), leafDigest: '4'.repeat(64) }, { actor: 'worker:w-b', key: 'or-e8-p1' });
    store.proposeOrientationCandidate({ packDigest: '3'.repeat(64), leafDigest: '5'.repeat(64) }, { actor: 'worker:w-b', key: 'or-e8-p2' });
  });
  assert.equal(proposalRefusal, 'orientation_receipt_ceiling',
    'the per-attempt PROPOSAL ceiling refuses BEFORE append (today: the propose API does not exist)');
});

test('OR-E9 [stage: propose-verification-missing]: orientation.candidate.propose verifies the attempt previously received the leaf and coalesces duplicates by {leafDigest, freshnessDigest}', () => {
  const store = makeStore('e9');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  // Prior-receipt verification (O-2): the hub resolves the cited immutable leaf and proves the
  // proposing attempt previously RECEIVED it — attempt b has no grant/read of this pack here.
  const unseen = refusalCode(() => store.proposeOrientationCandidate(
    { packDigest: '0'.repeat(64), leafDigest: '1'.repeat(64) },
    { actor: 'worker:w-b', key: 'or-e9-unseen' },
  ));
  assert.equal(unseen, 'orientation_propose_refused',
    'proposing a pack the attempt never received refuses with the constant invented code (header) — no candidacy laundering of unseen leaves');
  assert.equal(store.queryKnowledge({}).some((node) => JSON.stringify(node).includes('1'.repeat(64))), false,
    'no candidate node materializes for an unverified proposal');
  // A verified proposal (the attempt DID read the pack — the context.read receipt exists) mints;
  // an exact duplicate coalesces by {leafDigest, freshnessDigest} under a different idempotency key.
  store.recordContextRead({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.detail', normalizedQueryDigest: digest({ pack: 'seen' }),
    packDigest: '3'.repeat(64), freshnessDigest: '2'.repeat(64),
  }, { actor: 'worker:w-b', key: 'or-e9-read' });
  const first = store.proposeOrientationCandidate({ packDigest: '3'.repeat(64), leafDigest: '4'.repeat(64) }, { actor: 'worker:w-b', key: 'or-e9-p1' });
  assert.ok((first?.node ?? first?.candidate)?.id ?? null, 'a verified proposal mints the observed candidate');
  const before = store.snapshot().lastSeq;
  const duplicate = store.proposeOrientationCandidate({ packDigest: '3'.repeat(64), leafDigest: '4'.repeat(64) }, { actor: 'worker:w-b', key: 'or-e9-p2' });
  assert.equal(store.snapshot().lastSeq, before, 'a duplicate proposal for the same {leafDigest, freshnessDigest} coalesces — no second append');
  assert.equal((duplicate?.node ?? duplicate?.candidate)?.id, (first?.node ?? first?.candidate)?.id,
    'the coalesced duplicate returns the prior candidate');
});

test('OR-E10 [stage: overlay-merge-missing]: an exactly-matching curated leaf APPLIES; conflicting live leaves without a Supersedes winner omit ALL with overlay_conflict; a live winner applies', () => {
  const store = makeStore('e10');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const moduleKey = { repoId: 'repo-a', rootPath: 'lane-b' };
  const moduleDigest = '7'.repeat(64); const freshnessDigest = '8'.repeat(64);
  const source = store.mintOrientationSource({ repoId: 'repo-a', moduleKey, moduleDigest, freshnessDigest }, { actor: 'orchestrator', key: 'or-e10-source' });
  const cite = (leafId, key) => store.addKnowledgeEdge(
    { id: `knowledge-edge:cites:${leafId}`, type: 'Cites', from: leafId, to: source?.node?.id ?? '', evidence: [{ coordinationSeq: 1 }] },
    { actor: 'policy', key },
  );
  const leaf = (id, body, key) => store.addKnowledgeNode({
    id, type: 'Finding', grounding: 'observed', body, evidence: [{ coordinationSeq: 1 }],
    promotion: { kind: 'Finding', trigger: 'orientation.overlay_proposed' },
  }, { actor: 'policy', key });
  // Positive application (O-4 — blue-team §2 gap): a curated leaf on the EXACT live
  // moduleDigest/freshness coordinate MUST apply to the served map.
  leaf('finding:overlay-pos', 'lane-b owns the fence table', 'or-e10-leaf-1');
  cite('finding:overlay-pos', 'or-e10-cite-1');
  const applied = store.mergeOrientationMap({ repoId: 'repo-a', moduleKey, moduleDigest, freshnessDigest });
  assert.ok(JSON.stringify(applied?.map ?? {}).includes('lane-b owns the fence table'),
    'a curated leaf whose moduleDigest/freshness EXACTLY match APPLIES (the positive leg OR-E5 lacks)');
  // Conflict: a second live curated leaf for the same field, NO live Supersedes winner — ALL
  // conflicting values omit with overlay_conflict, never a pick by event time/insertion order.
  leaf('finding:overlay-challenger', 'lane-b owns the message lane', 'or-e10-leaf-2');
  cite('finding:overlay-challenger', 'or-e10-cite-2');
  const conflicted = store.mergeOrientationMap({ repoId: 'repo-a', moduleKey, moduleDigest, freshnessDigest });
  const served = JSON.stringify(conflicted?.map ?? {});
  assert.equal(served.includes('lane-b owns the fence table'), false, 'conflict: the first leaf is NOT kept by insertion order');
  assert.equal(served.includes('lane-b owns the message lane'), false, 'conflict: the second leaf is NOT kept by event time');
  assert.ok((conflicted?.overlayOmissions ?? []).filter((row) => row.reason === 'overlay_conflict').length >= 2,
    'BOTH conflicting curated values omit with structured overlay_conflict trace');
  // A live Supersedes winner resolves the pair deterministically: the winner applies.
  store.addKnowledgeEdge(
    { id: 'knowledge-edge:supersedes:or-e10', type: 'Supersedes', from: 'finding:overlay-pos', to: 'finding:overlay-challenger', evidence: [{ coordinationSeq: 1 }], expectedValidityVersion: 1 },
    { actor: 'policy', key: 'or-e10-supersede' },
  );
  const resolved = store.mergeOrientationMap({ repoId: 'repo-a', moduleKey, moduleDigest, freshnessDigest });
  assert.ok(JSON.stringify(resolved?.map ?? {}).includes('lane-b owns the fence table'), 'the live Supersedes winner applies');
  assert.equal(JSON.stringify(resolved?.map ?? {}).includes('lane-b owns the message lane'), false, 'the superseded leaf stays omitted');
  assert.equal((resolved?.overlayOmissions ?? []).some((row) => row.reason === 'overlay_conflict'), false,
    'a resolved conflict is never reported as overlay_conflict');
});

// ===========================================================================
// O-7 — the closed rating event, store-level semantics (stage: the
// orientation.rating_recorded event and its admission API do not exist).
// ===========================================================================

test('OR-E6 [stage: rating-api-missing]: the hub mints orientation.rating_recorded with the attempt identity and grant/read proof; the caller supplies ONLY {packDigest, rating}', () => {
  const store = makeStore('e6');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const attempt = { repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b', grantOrReadEventSeq: 1 };
  const rated = store.recordOrientationRating({ packDigest: '5'.repeat(64), rating: 'useful' }, { actor: 'worker:w-b', key: 'or-e6-rate', attempt });
  const event = rated?.event ?? rated;
  assert.equal(event?.kind, 'orientation.rating_recorded', 'the dedicated closed rating event — not a free-form scratchpad kind');
  for (const key of ['repoId', 'runId', 'taskId', 'taskVersion', 'workerId', 'packDigest', 'grantOrReadEventSeq', 'rating']) {
    assert.notEqual(event?.payload?.[key], undefined, `rating payload.${key} is hub-derived (attempt identity + receipt proof)`);
  }
  assert.equal(event?.payload?.rating, 'useful', 'the closed rating value passes through');
  const unknown = refusalCode(() => store.recordOrientationRating(
    { packDigest: '0'.repeat(64), rating: 'missed' },
    { actor: 'worker:w-b', key: 'or-e6-unknown', attempt },
  ));
  assert.equal(unknown, 'orientation_rating_refused',
    'invisible, unknown, stale-task, and out-of-scope targets all draw the ONE constant refusal (no pack-existence leak)');
  // T-14: hub-derivation is ENFORCED, never caller-trusted — an attempt tuple contradicting the
  // hub's own task record (task b is version 2 under worker w-b in this fixture) draws the same
  // constant refusal rather than minting under caller-claimed coordinates.
  const forged = refusalCode(() => store.recordOrientationRating(
    { packDigest: '5'.repeat(64), rating: 'useful' },
    { actor: 'worker:w-b', key: 'or-e6-forged', attempt: { ...attempt, taskVersion: 99, workerId: 'w-zzz' } },
  ));
  assert.equal(forged, 'orientation_rating_refused',
    'a caller-forged attempt tuple (wrong taskVersion/workerId) refuses — the hub derives attempt identity, it never trusts transport claims (blue-team T-14)');
});

test('OR-E7 [stage: rating-api-missing]: rating identity is {taskId, taskVersion, packDigest} — exact replay returns the prior event; an opposite second rating refuses orientation_rating_conflict', () => {
  const store = makeStore('e7');
  complete(store, 'a', 'w-a');
  complete(store, 'b', 'w-b');
  const attempt = { repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b', grantOrReadEventSeq: 1 };
  const first = store.recordOrientationRating({ packDigest: '5'.repeat(64), rating: 'useful' }, { actor: 'worker:w-b', key: 'or-e7-rate', attempt });
  const before = store.snapshot().lastSeq;
  const replay = store.recordOrientationRating({ packDigest: '5'.repeat(64), rating: 'useful' }, { actor: 'worker:w-b', key: 'or-e7-rate', attempt });
  assert.equal(store.snapshot().lastSeq, before, 'exact replay appends nothing');
  assert.equal((replay?.event ?? replay)?.seq, (first?.event ?? first)?.seq, 'exact replay returns the prior event');
  const conflict = refusalCode(() => store.recordOrientationRating(
    { packDigest: '5'.repeat(64), rating: 'missed' },
    { actor: 'worker:w-b', key: 'or-e7-rate', attempt },
  ));
  assert.equal(conflict, 'orientation_rating_conflict', 'an opposite second rating refuses — history is never overwritten');
  const events = store.events().filter((event) => event.kind === 'orientation.rating_recorded');
  assert.equal(events.length, 1, 'at most one rating per granted pack per task attempt ever appends');
});

// ===========================================================================
// O-8 — answer-time availability over the EXISTING ATLAS plane (stage: the
// coverage object and the orientation_unavailable/partial ladder invariants do
// not exist; the deployment-time flag is frozen).
// ===========================================================================

test('OR-A1 [stage: coverage-missing]: zero in-scope supported files yields orientation_unavailable — citable, coverage-carrying, never fabricated', async (t) => {
  const root = repo('a1', { 'README.md': '# docs only\n', 'guide.py': 'print(1)\n' });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const map = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: built.provenance.index_epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.equal((map.payload ?? []).length, 0, 'control: no supported files, no fabricated items');
  assert.equal(map.status, 'orientation_unavailable',
    'zero in-scope supported files yields the typed honest-empty status (today: ok with a prose summary only)');
  for (const key of ['totalFiles', 'supportedFiles', 'unsupportedFiles', 'excludedFiles', 'parseErrorFiles', 'parseErrorCount']) {
    assert.equal(typeof map.coverage?.[key], 'number', `coverage.${key} is surfaced on every answer`);
  }
  assert.equal(map.coverage?.supportedFiles, 0, 'the coverage denominator makes the empty index explicit');
  assert.ok(Array.isArray(map.refs) && map.refs.length >= 1, 'the honest-empty answer is a first-class citable tier result');
});

test('OR-A2 [stage: frozen-availability]: availability derives per-answer — a repo gaining its first supported file after startup never wears the honest-empty label', async (t) => {
  const root = repo('a2', { 'README.md': '# docs\n' });
  const composed = driver(root); // the deployment-time availability flag freezes 'empty' here
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  write(root, 'src/app.js', 'export const app = 1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'gain the first supported file']);
  const map = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: built.provenance.index_epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.ok((map.payload ?? []).some((item) => item.path === 'src/app.js'),
    'control: the per-query overlay sees the newly added supported file');
  assert.doesNotMatch(String(map.summary ?? ''), /honest empty/iu,
    'the frozen deployment-time flag must not stamp honest-empty over NON-EMPTY results (availability derives from the answer\'s own scoped snapshot)');
  assert.ok((map.coverage?.supportedFiles ?? 0) >= 1, 'per-answer coverage counts the supported file');
});

test('OR-A3 [stage: partial-labeling-missing]: an in-scope unsupported or parse-failed file labels the answer partial with coverage counts — never completeness-claiming', async (t) => {
  const root = repo('a3', {
    'src/ok.js': 'export const ok = 1\n',
    'src/tool.py': 'print(2)\n',
    'src/broken.js': 'export const broken = (\n',
  });
  const composed = driver(root);
  t.after(() => composed.close());
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const map = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: built.provenance.index_epoch }, { budgetTokens: 5_000, worktreeRoot: root });
  assert.ok((map.payload ?? []).some((item) => item.path === 'src/ok.js'), 'control: the supported file serves');
  assert.equal(map.status, 'partial',
    'any in-scope unsupported/excluded/unreadable/parse-failed file labels the answer partial (the scip.export precedent as a ladder invariant)');
  assert.equal(map.coverage?.unsupportedFiles, 1, 'the unsupported .py file is counted in the denominator, not hidden');
  assert.ok((map.coverage?.parseErrorFiles ?? 0) >= 1, 'the parse-failed file is counted');
  assert.equal(typeof map.coverage?.parseErrorCount, 'number');
});

// ===========================================================================
// TG2/TG3 farm-guard pin — an orientation-class read receipt is never progress.
// ===========================================================================

test('OR-T1 (pin) [farm-guard]: a context.read-class wire emission never answers the TG3 steering cycle; a genuine resumed turn still does', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ requiredEffects: ['repository_edit'] }));
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'checkpoint' },
  });
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1,
    'control: the TG3 cycle arms on a completed turn with unmet required effects');
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.map' }, 'or-t1-read');
  await flush(40);
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1,
    'an orientation read receipt NEVER counts as progress (the farm-guard stays)');
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush(40);
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0,
    'control: a genuine resumed turn answers the cycle — the cycle machinery itself is live in this fixture');
});
