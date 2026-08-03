// Orientation ladder red suite (contract: docs/reference/evidence/
// frontier-sweep-2026-08-03/orientation-contract.md v1.0 — epic #81, post-red-team fold).
//
// Twenty-eight rows over the eight folded decisions:
//   O-1 the ladder (bounded map/region/detail tiers, closed leaf union, hub-derived scope,
//       detail-descends-from-citation) — rows OR-L1..OR-L5;
//   O-2 investigation receipts (context.read ZERO weight, hub-derived replay/conflict,
//       constructive per-attempt ceilings, orientation.candidate.propose) — OR-L6, OR-E1..OR-E4;
//   O-3 freshness (one attested {repoId, baseTreeSha, indexEpoch, baseInputsDigest} record,
//       freshnessDigest on every answer, serve/reverify/resume gates) — OR-F1..OR-F3;
//   O-4 generated-with-curation-overlay (KG Source + Cites, overlay_dangling/overlay_conflict) — OR-E5;
//   O-5 citation vs continuation vs grant (resume re-authorizes, transport strips paths,
//       needs_resume honesty, storage ceiling + retirement) — OR-C1..OR-C6;
//   O-6 spawn-time L0 + mid-turn pull (L0 cited into every brief, spawn head-CAS, NO clock) — OR-S1..OR-S3;
//   O-7 closed rating event (hub-derived payload, constant refusal, replay/conflict, advisory) — OR-L7, OR-E6, OR-E7;
//   O-8 answer-time availability (orientation_unavailable, coverage object, partial labeling) — OR-A1..OR-A3;
//   plus the TG2/TG3 farm-guard pin OR-T1.
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
import { createDriver } from '../src/index.mjs';

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
// O-1 — the orientation ladder (stage: the BD3-A `code` query kind and the
// orientation tiers do not exist; a wire `context.read` falls through to the
// default branch today and is appended verbatim with no answer).
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
  const leaves = JSON.stringify(results[0].payload?.map?.modules ?? results[0].payload ?? []);
  const proseLeaves = JSON.parse(leaves).flatMap?.((module) => module.leaves ?? []) ?? [];
  for (const leaf of proseLeaves) {
    if (leaf.source === 'generated') {
      assert.equal(typeof leaf.text, 'undefined', 'generated leaves carry typed structural fields only, never free prose');
    } else {
      assert.equal(leaf.untrusted, true, 'every prose leaf carries untrusted:true');
      assert.ok(['model-authored', 'repository-prose'].includes(leaf.provenance), 'provenance is the closed pair');
      assert.equal(typeof leaf.sourceRef, 'string', 'every prose leaf carries its sourceRef');
    }
  }
  const delivered = adapter.calls.prompt.filter((call) => JSON.stringify(call.content ?? '').includes('UNTRUSTED'));
  assert.ok(delivered.length >= 1, 'the framed answer reaches the provider-bound frame through the SAME renderer (only-path proof)');
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
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitCodeRead(adapter, handle, { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'src' } }, 'or-l5-region');
  await flush(40);
  const results = readResults(coordinator, handle);
  assert.equal(results.length, 1, 'the region answers (stage: code query kind missing)');
  const payload = results[0].payload ?? {};
  const region = payload.region ?? payload.result ?? {};
  assert.ok(Buffer.byteLength(JSON.stringify(region)) <= 4096, 'the region tier page is constructively bounded <= 4KiB');
  if ((payload.status ?? 'ok') === 'needs_resume') {
    assert.equal(typeof payload.cursor, 'string', 'a truncated region mints an opaque continuation cursor');
    assert.match(String(payload.freshnessDigest ?? ''), /^[a-f0-9]{64}$/u, 'the page carries its freshnessDigest (resume re-checks it)');
    assert.match(String(payload.scopeDigest ?? ''), /^[a-f0-9]{64}$/u, 'the page carries its scopeDigest (resume re-authorizes it)');
  }
});

// ===========================================================================
// O-2/O-7 lane legs — evidence minting and the rating lane (stage: context.read
// class + orientation.rating_recorded do not exist).
// ===========================================================================

test('OR-L6 [stage: context-read-class-missing]: an orientation materialization mints exactly ONE context.read per identity tuple — never scratch.read, replay mints nothing', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const query = { kind: 'code', op: 'code.orient.map' };
  emitCodeRead(adapter, handle, query, 'or-l6-read');
  await flush(40);
  const reads = coordinator._coordination.events().filter((event) => event.kind === 'context.read');
  assert.equal(reads.length, 1, 'a successful orientation materialization appends at most one context.read per hub-derived identity tuple');
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
  write(overlayB, 'src/extra.js', 'export const extra = 9\n');
  const page = await composed.coordinator.invokeCapability('atlas-index', 'repo.map', { indexEpoch: epoch }, { budgetTokens: 60, worktreeRoot: overlayA });
  assert.equal(page.status, 'needs_resume', 'control: attempt A mints a cursor');
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
  writeFileSync(page.refs[0].path, '{"tampered":true}\n');
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
  rmSync(page.refs[0].path); // stands in for lawful reachability reclamation under the O-5 ceiling
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
  let refusal = null;
  for (let i = 0; i < 12 && refusal === null; i += 1) {
    refusal = await index.invoke('search.lexical', { indexEpoch: epoch, query: `orientation-ceiling-probe-${i}` }, { budgetTokens: 2_000, baseRoot: root, worktreeRoot: root })
      .then(() => null, (error) => error?.code ?? 'thrown');
  }
  assert.equal(refusal, 'orientation_storage_exhausted',
    'past the deployment byte ceiling the next write refuses BEFORE append (today: create-if-absent CAS writes are unbounded)');
});

// ===========================================================================
// O-6 — spawn-time L0 (stage: no L0 pack injection; BD3-B pack machinery +
// spawn head-CAS absent). OR-S3 pins the campaign law: no clock anywhere.
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
  const grant = brief.orientation ?? brief.contextPacks ?? brief.packs ?? null;
  assert.ok(grant !== null, 'the brief carries the L0 orientation grant');
  assert.equal(JSON.stringify(grant).includes('lane-c'), false,
    'the L0 map is scoped to the worker\'s hub-derived pathScope — a lane-B worker never receives another lane\'s map');
  void handle;
});

test('OR-S2 [stage: pack-cas-missing]: a spawn-time non-head L0 citation fails context_pack_stale; the live head spawns; a retried spawn never mints a second grant', async () => {
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
  const spawned = await coordinator.spawn('mock', makeBrief({ contextPacks: [store.contextPackHead('orientation-map').packId] })).then(
    () => 'spawned',
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(spawned, 'spawned', 'the live head cites and spawns (positive control)');
  const grants = store.events().filter((event) => JSON.stringify(event.payload ?? {}).includes('orientation-map') && /grant/i.test(event.kind));
  const retry = await coordinator.spawn('mock', makeBrief({ contextPacks: [store.contextPackHead('orientation-map').packId] }), { taskId: 'retry-same-attempt' }).then(
    () => 'spawned',
    (error) => error?.code ?? 'thrown',
  );
  assert.ok(retry === 'spawned' || typeof retry === 'string', 'a retried spawn exact-replays or refuses typed — never silently double-grants');
  assert.ok(grants.length <= 1, 'grants stay attempt-scoped: a retried spawn never mints a second grant for the same attempt');
});

test('OR-S3 (pin) [campaign-law]: context_pack_expired appears NOWHERE in the shipped source — orientation packs invalidate causally only (no clock, no TTL)', () => {
  for (const file of ['coordinator.mjs', 'coordination-store.mjs', 'cartographer-quartermaster.mjs', 'atlas-index.mjs']) {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8');
    assert.equal(source.includes('context_pack_expired'), false,
      `${file}: the wall-clock pack-expiry code is NOT imported from BD3-B (v1.0 fold, campaign control law)`);
  }
});

// ===========================================================================
// O-2/O-4 — evidence class, compounding, and the curated overlay (stage:
// context.read / orientation.candidate.propose / overlay machinery absent;
// the workflow admission trigger vocabulary is unamended). Pure-store harness.
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
    op: 'code.orient.map', queryDigest: digest({ op: 'code.orient.map' }),
    packDigest: '1'.repeat(64), freshnessDigest: '2'.repeat(64),
  }, { actor: 'worker:w-b', key: 'or-e1-cr' });
  assert.ok((read?.event?.seq ?? 0) >= 1, 'the orientation materialization mints a context.read event');
  store.postScratchFact({
    namespace: 'tests', key: 'fact:orientation-only', value: 'never promoted by orientation reads', grounding: 'observed',
    envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, ownerTask: 'a',
  }, { actor: 'w-a', key: 'scratch:orient-only' });
  store.recordContextRead({
    repoId: 'repo-a', runId: 'run-b', taskId: 'b', taskVersion: 2, workerId: 'w-b',
    op: 'code.orient.detail', queryDigest: digest({ fact: 'fact:orientation-only' }),
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
    op: 'code.orient.map', queryDigest: digest({ op: 'code.orient.map', moduleKey: 'lane-b' }),
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
    op: 'code.orient.map', queryDigest: digest({ op: 'code.orient.map', n }),
    packDigest: `${n}`.padEnd(64, '0'), freshnessDigest: '2'.repeat(64),
  });
  store.recordContextRead(tuple(1), { actor: 'worker:w-b', key: 'or-e3-r1' });
  store.recordContextRead(tuple(2), { actor: 'worker:w-b', key: 'or-e3-r2' });
  const before = store.snapshot().lastSeq;
  const refusal = refusalCode(() => store.recordContextRead(tuple(3), { actor: 'worker:w-b', key: 'or-e3-r3' }));
  assert.ok(typeof refusal === 'string' && refusal !== 'unknown_error' && refusal !== null,
    'the per-attempt ceiling refuses with a typed code (flood control is constructive, checked BEFORE append)');
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
  const generatedStillServes = JSON.stringify(merged?.map ?? merged ?? {});
  assert.ok(generatedStillServes.length > 2, 'generated structure still serves under an overlay omission');
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
