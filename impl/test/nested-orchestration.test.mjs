// Nested-orchestration rung red suite (contract: docs/reference/evidence/
// nested-orchestration-2026-08-03/nested-orchestration-contract.md + contract-fold.md,
// grounding.md, contract-redteam.md — issue #12). Blue-team fold suite-blueteam.md /
// suite-fold.md; the AX-review wave reports carry the folded reviewers' findings.
//
// Fifteen rows over the folded decisions (7 pins + 8 reds). The pins assert what
// legitimately EXISTS today (WebSessionStore mint/authenticate/revoke/rotate, the
// run-orchestrator lease machinery with lease-epoch TTL under an injected clock, the
// recursive-session gate constancy, the transport run_stop owner/foreign constancy, the
// legacy-owner path unchanged, the v1 lane reach on the child's OWN subtree, and the
// resolve-then-authorize constancy rows). The reds fail at NAMED STAGES and go green on
// the contract's implementation ONLY:
//
//   R1 stage: connection-mint-missing       — baton.connectionAuthority.mintChildAuthority
//   R2 stage: connection-projection-missing — RuntimeIsolation.create posture.connectionProjection
//   R3 stage: xdg-delete-missing            — the child runtime env deletes XDG_CONFIG_HOME
//   R4 stage: runstop-carveout-missing      — transport run_stop admits a lease-bound child on
//                                              its OWN subtree without emergency_stop
//   R5 stage: legacy-refusal-missing        — worker:-prefixed principals refuse the legacy
//                                              operator command set (per family)
//   R6 stage: lane-scope-binding-missing    — the six subtree-less workflow lanes refuse
//                                              foreign/unknown runs with the one constant
//   R7 stage: terminal-revoke-missing       — baton.revokeChildAuthority on a terminal parent
//   R8 stage: orphan-sweep-missing          — baton.sweepChildOrphans on startup
//
// Invented surfaces (namespace-imported from ../src/index.mjs so a missing export never
// kills the file at load; absent today → each RED row fails at its named stage):
//
//   baton.connectionAuthority.mintChildAuthority({
//     schemaVersion, repoId, coordination, sessions, parentTask, parentConnection, runtimeRoot,
//   }) → { session: {sessionId, credentialId, token, expiresAt},
//          lease:   {leaseId, expiresAt},
//          projection: {schemaVersion, profile, tokenFile, url, origin} }
//     parentConnection is the RESOLVED discovery-contract parent connection
//     ({schemaVersion, url, origin, tokenFile, token}). The mint returns a FRESH child
//     session + run-orchestrator lease + a connection projection whose profile/token land
//     INSIDE the worker-private runtimeRoot (token file mode 0600). The child credential is
//     never a copy of the parent's: digest inequality + content independence.
//
//   baton.connectionAuthority.revokeChildAuthority({
//     schemaVersion, coordination, sessions, sessionId, leaseId, reason,
//   }) → { ok: true, result: 'revoked' }
//     Revoke the child session (sessions.revoke) AND the child lease
//     (revokeRunOrchestratorLease) when the parent task reaches a terminal path.
//
//   baton.connectionAuthority.sweepChildOrphans({
//     schemaVersion, coordination, sessions, deadlineMs, runtime,
//   }) → { ok: true, swept: <non-negative integer> }
//     Startup sweep: revoke child sessions/leases whose parent task is terminal or whose
//     lease epoch has expired, so a crashed parent leaves no live child authority.
//
// RuntimeIsolation.create gains a third options argument ({connectionProjection}) whose
// value is projected onto the returned posture as `posture.connectionProjection`.
//
// Pin list (must stay green today AND after the rung — a wrong implementation has nowhere
// to hide):
//   P1  WebSessionStore issue/authenticate/revoke/rotate/isPrincipalActive machinery.
//   P2  Lease-epoch TTL: lease.expiresAt === issuedAt + leaseTtlMs (min with session TTL);
//       the lease refuses with run_orchestrator_lease_expired past the epoch — all under an
//       injected mutable clock, no wall-clock reads.
//   P3  Recursive-session gate constancy: a sessionAuthority context keeps runs.list
//       behind run_orchestrator_command_forbidden and keeps
//       application.help admitted (the read lane the gate must never take down).
//   P4  Transport run_stop constancy: owner (emergency_stop) → 200; non-lease child without
//       emergency_stop → 403 forbidden. Both stay constant; the carve-out (R4) is narrow.
//   P5  Legacy operator set constancy for the NON-worker owner: every family still 200.
//   P6  v1 lane reach on the child's OWN subtree: message.send/receipt, attention.watch (the
//       lane's own lease-parent law), scratchpad.read/elevate, knowledge.seed.
//   P7  Resolve-then-authorize constancy: unknown message.receipt and unknown/cross-run
//       scratchpad.elevate → application_unauthorized; foreign/unknown attention.watch →
//       attention_scope_forbidden (the lane's own landed law).
//
// Verified split (baseline, two consecutive runs): 7 pins green, 8 reds failing at their
// named stages. NUL-byte discipline: this suite never reads application.mjs /
// coordination-store.mjs / coordinator.mjs wholesale (behavioral rows only); the fixture
// stack is the waveFixture idiom (real createDriver + ScriptableAdapter)
// plus the phase77 standalone-store transport idiom.
//
// Campaign law: every control is a constructor-injected clock, never a wall-clock;
// durations are epoch deltas, never sleeps; every refusal the rows assert is a coded
// error the lane/transport derives itself.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import {
  CoordinationStore,
  createDriver,
  DEFAULT_RUN_LINEAGE_POLICY,
  RuntimeIsolation,
  WebNorthbound,
  WebSessionStore,
} from '../src/index.mjs';
// Namespace import for the invented connection-authority surface: absent today, so every
// red row that touches it fails at its named stage — the file still loads cleanly.
import * as connectionAuthority from '../src/index.mjs';

const REPO = 'repo-nested-orchestration';
const NOW = '2026-08-06T00:00:00.000Z';
const EXPIRES = '2026-08-06T01:00:00.000Z';
const LEASE_TTL_MS = 60_000;
const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 16, leaseTtlMs: LEASE_TTL_MS,
});

const dirs = [];
const drivers = [];
function tmpDir(label = 'baton-nested-') {
  const d = mkdtempSync(join(tmpdir(), label));
  dirs.push(d);
  return d;
}
test.after(async () => {
  for (const driver of drivers) {
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function gitRepo(label) {
  const repo = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'baton-test@example.com', GIT_COMMITTER_EMAIL: 'baton-test@example.com' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Test', GIT_COMMITTER_NAME: 'Baton Test' });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  return repo;
}

const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

// The facade principal the LEASE actually recognizes: authorityOn's sessionId is the lease's
// session identity, so the driving principal MUST carry exactly that sessionId (a mismatched
// session id would draw run_orchestrator_session_mismatch at the gate — never the gate code).
function principalOfChild(child) {
  return Object.freeze({
    actor: `test:${child.principalId}:${child.sessionId}`,
    principalId: child.principalId,
    sessionId: child.sessionId,
  });
}

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

function mutableClock(initial = NOW) {
  let value = initial;
  return {
    now: () => value,
    set(next) { value = next; },
  };
}

// The bd3 staging adapter: admits spawns, records prompts, emits only what the harness
// drives (no autonomous turns — the receipt/attention rows control every epoch).
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'nested-orchestration', refreshedAt: null,
      },
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

const PROFILE = Object.freeze({
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
});

// Full application fixture (trimmed): one real createDriver
// stack so the facade, the kernel lanes, and the durable store share state. The host
// authorize policy defaults to the CURRENT vacuous admit (the seam the lane-scope binding
// must land in) — R6 drives foreign runs through it and must fail today.
async function facadeFixture(t, { authorize = async () => true, adapter = new ScriptableAdapter() } = {}) {
  const repo = gitRepo('baton-nested-repo-');
  const logDir = tmpDir('baton-nested-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  drivers.push(driver);
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('nested-planner'),
      dispatcher: principalOf('nested-dispatcher'),
      observer: principalOf('nested-observer'),
    },
    authorize,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('nested-cleanup')); } catch { /* RED failures may interrupt setup */ }
  });
  const coordination = driver.coordination;
  return { repo, logDir, adapter, driver, application, coordination };
}

// A run-shaped worker (byte-exact steering.registered record, the run-creation ceremony).
async function spawnMember(fx, { runId, role = 'member', waveId = 'wave:nested' }) {
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId });
  fx.coordination.recordDriver('steering.registered', {
    runId, driverKind: 'wave', actor: 'test:orchestrator', waveId, waveRole: role,
  }, { actor: 'test:orchestrator', key: `run.steering_registered:${runId}` });
  return handle;
}

function writeNote(fx, { runId, taskId, workerId, text, key }) {
  return fx.coordination.writeScratchpad(
    { runId, taskId, workerId, entry: { kind: 'note', text } },
    { actor: 'worker', principalId: workerId, key },
  );
}

function completeTask(fx, taskId) {
  const task = fx.coordination.task(taskId);
  return fx.coordination.transitionTask(taskId, 'completed', task.version, {
    actor: 'policy', key: `nested.complete:${taskId}`,
  });
}

// The authority-red lease ceremony: an orchestrator task on runId, a claimed worker,
// and an issued run-orchestrator lease; returns the closed sessionAuthority proof plus the
// coordinates the child principal (lease holder) carries.
function authorityOn(fx, { runId, principalId, sessionId }) {
  const coordination = fx.coordination;
  const authorityDigest = digest({ proof: `${runId}:${principalId}:${sessionId}` });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const taskId = `task-${runId}-${principalId}`.replaceAll(':', '-');
  const workerId = `worker-${runId}-${principalId}`.replaceAll(':', '-');
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'mock', harnessResolved: 'mock@fixture',
      modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
      effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
      routeKey: '["mock","fixture","mock-model","low"]',
    }).task;
  const leaseId = `run-orchestrator-lease:${digest({
    repoId: REPO, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: authorityDigest,
  })}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest, expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const sessionAuthority = Object.freeze({
    schemaVersion: 1, authorityDigest, expiresAt, orchestratorLeaseId: receipt.lease.leaseId,
  });
  return { receipt, runId, principalId, sessionId, sessionAuthority, taskId, workerId };
}

// Admit a child-run lineage record carrying the parent's lease (the subtree oracle the
// lease-scope binding resolves through).
function admitChildLineage(fx, lease, childRunId, objective = 'nested child workstream') {
  return fx.coordination.admitRunLineage({
    schemaVersion: 1, repoId: REPO, childRunId,
    intentDigest: digest({ childRunId, objective }),
  }, {
    actor: `orchestrator:${lease.session.principalId}:${lease.session.sessionId}`,
    key: `run.lineage:${childRunId}`,
    principalId: lease.session.principalId,
    sessionId: lease.session.sessionId,
    sessionAuthorityDigest: lease.session.authorityDigest,
    orchestratorLeaseId: lease.leaseId,
  });
}

async function facadeError(fn) {
  try { await fn(); return null; } catch (error) { return { code: error?.code ?? null, message: error?.message ?? null }; }
}

const recursiveContext = (lease) => Object.freeze({
  requestId: 'nested-gate', idempotencyKey: 'nested-gate',
  transport: 'direct', sessionAuthority: lease.sessionAuthority,
});

// ===========================================================================
// Transport staging (phase77 idiom): a standalone CoordinationStore + recorder
// + WebNorthbound, so the web capability/scope seams are the unit under test.
// ===========================================================================

function workingParent(store, label, principalId, sessionId) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: { objective: 'Serve authenticated recursive Baton commands', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-transport-session', principalId, sessionId }),
    expiresAt: EXPIRES,
  };
  const identity = {
    repoId: REPO, parentRunId: runId, parentTaskId: taskId,
    parentTaskVersion: task.version, workerId, principalId, sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const lease = store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO,
    parentTask: { id: taskId, version: task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
  return { lease, runId, task };
}

function applicationRecorder(calls, replays = []) {
  return {
    repoId: REPO,
    card: () => ({
      schemaVersion: 1, repoId: REPO,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
    }),
    async authorizeReplay(name, args, principal, context) {
      replays.push({
        name, args: structuredClone(args), principal: structuredClone(principal),
        context: { ...structuredClone(context), capabilityAuthority: context.capabilityAuthority },
      });
      return true;
    },
    async command(name, args, principal, context) {
      calls.push({
        name, args: structuredClone(args), principal: structuredClone(principal),
        context: { ...structuredClone(context), capabilityAuthority: context.capabilityAuthority },
      });
      return { schemaVersion: 1, runId: args.intent?.runId ?? args.runId, phase: 'awaiting_plan_approval' };
    },
  };
}

function admitRecipientHistory(store, parent, label) {
  const childRunId = `run-${label}-history-child`;
  const request = {
    schemaVersion: 1,
    repoId: REPO,
    childRunId,
    intentDigest: digest({ childRunId, objective: 'Establish durable recursive recipient history' }),
  };
  store.admitRunLineage(request, {
    actor: `transport:${parent.lease.session.principalId}:${parent.lease.session.sessionId}`,
    key: `run.lineage:${childRunId}`,
    principalId: parent.lease.session.principalId,
    sessionId: parent.lease.session.sessionId,
    sessionAuthorityDigest: parent.lease.session.authorityDigest,
    orchestratorLeaseId: parent.lease.leaseId,
  });
  return childRunId;
}

// The legacy operator surface the child session must NOT reach (stage:
// legacy-refusal-missing). Every family is genuinely implemented in the stub so that
// TODAY's behavior is a real 200 admission — never a fixture crash.
function legacyCoordinator() {
  const ok = { ok: true };
  return {
    spawn: async () => ({ ok: true, workerId: 'legacy-spawned' }),
    send: async () => ok,
    interrupt: async () => ok,
    kill: async () => ok,
    drain: async () => ok,
    respond: async () => ok,
    invokeCapabilityNorthbound: async () => ok,
  };
}

function transportPrincipal(userId, capabilities, sessionId = `session-${userId}`) {
  return {
    userId, sessionId, credentialId: `credential-${userId}`,
    authMethod: 'bearer', expiresAt: EXPIRES, revoked: false,
    capabilities: [...capabilities], repoIds: [REPO],
  };
}

function transportWeb(store, coordinator) {
  const calls = [];
  const replays = [];
  const web = new WebNorthbound({
    coordinator: coordinator ?? legacyCoordinator(),
    coordination: store, application: applicationRecorder(calls, replays),
    repoIds: [REPO], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse(NOW),
  });
  return { calls, replays, web };
}

function webEnvelope(command, args, runId = null, extra = {}) {
  return {
    schemaVersion: 1, commandId: `cmd-${command}-${digest({ command, args, runId })}`,
    idempotencyKey: `idem-${command}-${digest({ command, args, runId })}`,
    command, args, repoId: REPO, origin: 'https://control.example.test',
    ...(runId !== null ? { runId } : {}),
    ...extra,
  };
}

async function executeLegacy(web, principal, command, args, runId = null, extra = {}) {
  return web.execute({
    principal, origin: 'https://control.example.test', csrfToken: null,
    remoteAddress: '127.0.0.1', transport: 'https',
  }, webEnvelope(command, args, runId, extra));
}

// ===========================================================================
// Section P — pins (green today AND after the rung; a wrong implementation
// has nowhere to hide).
// ===========================================================================

test('P1 PIN: WebSessionStore mint/authenticate/revoke/rotate machinery is durable', (t) => {
  const root = tmpDir('baton-nested-session-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = mutableClock(NOW);
  const store = new WebSessionStore(root, { now: () => Date.parse(clock.now()) });
  const issued = store.issue({
    userId: 'child', authMethod: 'bearer', capabilities: ['observe', 'control'],
    repoIds: [REPO], ttlMs: 3_600_000,
  }, { actor: 'test:p1' });
  assert.equal(typeof issued.sessionId, 'string');
  assert.equal(typeof issued.credentialId, 'string');
  assert.equal(typeof issued.token, 'string');
  assert.equal(issued.expiresAt, EXPIRES);
  // The session is bearer-authenticatable and carries capabilities (issue returns the raw
  // credential; capabilities appear only through authenticate — the minted principal).
  const principal = store.authenticate({ headers: { authorization: `Bearer ${issued.token}` } });
  assert.equal(principal.userId, 'child');
  assert.equal(principal.sessionId, issued.sessionId);
  assert.deepEqual(principal.capabilities, ['observe', 'control']);
  assert.equal(store.isPrincipalActive(principal, { repoId: REPO }), true);
  assert.equal(store.isPrincipalActive({ ...principal, capabilities: ['observe', 'control', 'emergency_stop'] }, { repoId: REPO }), false,
    'a principal may not self-elevate beyond the session credential');
  // Rotation mints a fresh credential; the predecessor stays revoked.
  const rotated = store.rotate(issued.sessionId, { actor: 'test:p1' });
  assert.ok(rotated, 'a live session rotates');
  assert.notEqual(rotated.sessionId, issued.sessionId);
  assert.notEqual(rotated.token, issued.token, 'rotation never reuses the bearer credential');
  const rotatedPrincipal = store.authenticate({ headers: { authorization: `Bearer ${rotated.token}` } });
  assert.equal(store.isPrincipalActive(rotatedPrincipal, { repoId: REPO }), true);
  // Revocation is durable: the token no longer authenticates and the principal is inactive.
  const revoked = store.revoke(rotated.sessionId, { actor: 'test:p1' });
  assert.equal(revoked.result, 'revoked');
  assert.equal(store.authenticate({ headers: { authorization: `Bearer ${rotated.token}` } }), null);
  assert.equal(store.isPrincipalActive(rotatedPrincipal, { repoId: REPO }), false);
});

test('P2 PIN: the run-orchestrator lease is epoch-bound (issuedAt + leaseTtlMs) and refuses past the epoch', (t) => {
  const directory = tmpDir('baton-nested-p2-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const clock = mutableClock(NOW);
  const store = new CoordinationStore(directory, { repoId: REPO, clock: () => clock.now(), runLineagePolicy });
  const parent = workingParent(store, 'p2', 'child-p2', 'session-p2');
  // Static assertion on the epoch math, never a wall-clock read: the lease expires exactly
  // at issuedAt + leaseTtlMs because the session TTL (one hour) is far outside the epoch.
  assert.equal(parent.lease.expiresAt, new Date(Date.parse(NOW) + LEASE_TTL_MS).toISOString(),
    'the lease epoch is issuedAt + leaseTtlMs (min with the session TTL)');
  assert.equal(parent.lease.session.expiresAt, EXPIRES, 'the session expiry is the transport identity, unchanged');
  // The lease is live at issue under the injected clock.
  const live = store.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'child-p2', sessionId: 'session-p2', expiresAt: EXPIRES,
  });
  assert.equal(live.leaseId, parent.lease.leaseId);
  // Advance the injected clock ONE millisecond past the epoch: the lease refuses with the
  // typed expired constant — never a wall-clock or a silent pass.
  clock.set(new Date(Date.parse(NOW) + LEASE_TTL_MS + 1).toISOString());
  assert.throws(() => store.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'child-p2', sessionId: 'session-p2', expiresAt: EXPIRES,
  }), (error) => error?.code === 'run_orchestrator_lease_expired');
  store.releaseWriterLease();
});

test('P3 PIN: the recursive-session gate keeps behind-gate commands forbidden and application.help admitted', async (t) => {
  const fx = await facadeFixture(t);
  const child = authorityOn(fx, { runId: 'run:p3-parent', principalId: 'child-p3', sessionId: 'session-child-p3' });
  const childPrincipal = principalOfChild(child);
  const ctx = recursiveContext(child);
  // runs.list is NOT in the gate allowlist: a sessionAuthority context keeps it forbidden.
  const listRefusal = await facadeError(() => fx.application.command('runs.list', {}, childPrincipal, ctx));
  assert.equal(listRefusal?.code, 'run_orchestrator_command_forbidden');
  // application.help IS a gate allowlist read lane: the same sessionAuthority context serves it.
  const help = await fx.application.command('application.help', {}, childPrincipal, ctx);
  assert.ok(help && typeof help.schemaVersion === 'number', 'the help read lane survives the gate');
});

test('P4 PIN: transport run_stop constancy — owner 200, non-lease child 403', async (t) => {
  const directory = tmpDir('baton-nested-p4-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory, { repoId: REPO, clock: () => NOW, runLineagePolicy });
  const { web } = transportWeb(store, {});
  // Owner: emergency_stop + observe admits unconditionally — the operator path never churns.
  const owner = transportPrincipal('owner', ['emergency_stop', 'observe']);
  const ownerResponse = await awaitOwner(web, owner, 'run-p4-owner', 'done');
  assert.equal(ownerResponse.status, 200, 'the emergency-stop owner keeps the run_stop admission');
  // Non-lease child WITHOUT emergency_stop: the transport refuses BEFORE any application
  // dispatch — the constancy a narrow carve-out (R4) must preserve for non-lease callers.
  const child = transportPrincipal('child-p4', ['control', 'observe']);
  const childResponse = await awaitOwner(web, child, 'run-p4-child', 'done');
  assert.equal(childResponse.status, 403);
  assert.equal(childResponse.body?.error?.code, 'forbidden');
  store.releaseWriterLease();
});

// P4 uses an application recorder whose command() always answers 200 — the owner 200 is
// the transport's own admission (the recorder proves the dispatch reached the application).
async function awaitOwner(web, principal, runId, reason) {
  return web.execute({
    principal, origin: 'https://control.example.test', csrfToken: null,
    remoteAddress: '127.0.0.1', transport: 'https',
  }, webEnvelope('run_stop', { runId, reason }, runId));
}

test('P5 PIN: the legacy operator set stays 200 for the NON-worker owner', async (t) => {
  const directory = tmpDir('baton-nested-p5-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory, { repoId: REPO, clock: () => NOW, runLineagePolicy });
  const { web } = transportWeb(store, legacyCoordinator());
  const owner = transportPrincipal('owner', ['control', 'observe', 'approve', 'emergency_stop']);
  const cases = legacyFamilies('owner');
  for (const { command, args, runId, extra } of cases) {
    const response = await executeLegacy(web, owner, command, args, runId, extra);
    assert.equal(response.status, 200, `owner ${command} keeps the legacy admission`);
  }
  store.releaseWriterLease();
});

// P6 PIN: v1 lane reach on the child's OWN subtree — the child (lease holder) drives every
// workflow lane against runs the lease subtree owns, and the lanes serve.
test('P6 PIN: v1 lane reach on the child\'s own subtree', async (t) => {
  const fx = await facadeFixture(t);
  const child = authorityOn(fx, { runId: 'run:child-parent', principalId: 'child', sessionId: 'session-child' });
  admitChildLineage(fx, child.receipt.lease, 'run:own');
  const childPrincipal = principalOfChild(child);
  // message.send/receipt on the own subtree run (a live worker makes the run active).
  const handle = await spawnMember(fx, { runId: 'run:own' });
  const sent = await fx.application.command('run.message.send', {
    runId: 'run:own', kind: 'inform', body: 'child hello',
  }, childPrincipal, null);
  assert.equal(sent?.schemaVersion, 1);
  assert.match(sent?.messageId ?? '', /^message:[a-f0-9]{64}$/u);
  const receipt = await fx.application.command('run.message.receipt', { messageId: sent.messageId }, childPrincipal, null);
  assert.equal(receipt?.schemaVersion, 1);
  // attention.watch on the lease PARENT run — the lane's own already-landed law admits the
  // live lease holder by its parent run.
  const page = await fx.application.command('run.attention.watch', { runId: 'run:child-parent' }, childPrincipal, null);
  assert.equal(page?.schemaVersion, 1);
  assert.ok(Array.isArray(page?.reasons));
  // scratchpad.read + elevate on the own subtree run.
  const ownTask = fx.coordination.task(handle.taskId);
  const note = writeNote(fx, { runId: 'run:own', taskId: ownTask.id, workerId: handle.id, text: 'child note', key: 'p6-note' });
  const read = await fx.application.command('run.scratchpad.read', { runId: 'run:own', scope: 'shared' }, childPrincipal, null);
  assert.equal(read?.schemaVersion, 1);
  completeTask(fx, ownTask.id);
  const elevated = await fx.application.command('run.scratchpad.elevate', {
    runId: 'run:own', taskId: ownTask.id, entryIds: [note.entry.entryId],
  }, childPrincipal, null);
  assert.equal(elevated?.result, 'settled');
  // knowledge.seed inside the own subtree run's horizon.
  const seeded = await fx.application.command('run.knowledge.seed', {
    runId: 'run:own', type: 'Finding', grounding: 'observed', body: 'child finding',
  }, childPrincipal, null);
  assert.equal(seeded?.ok, true);
});

test('P7 PIN: resolve-then-authorize constancy — unknown message/scratchpad refuse with the one constant', async (t) => {
  const fx = await facadeFixture(t);
  const child = authorityOn(fx, { runId: 'run:p7-parent', principalId: 'child-p7', sessionId: 'session-p7' });
  const childPrincipal = principalOfChild(child);
  // Unknown message id: resolve-to-null ≡ unknown ≡ forbidden (landed resolve-then-authorize).
  const unknownMessage = await facadeError(() => fx.application.command('run.message.receipt', {
    messageId: `message:${'a'.repeat(64)}`,
  }, childPrincipal, null));
  assert.equal(unknownMessage?.code, 'application_unauthorized');
  // Unknown task: the elevate lane's resolve-then-authorize refuses before any elevation.
  const unknownTask = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: 'run:p7-parent', taskId: 'task-never-created', entryIds: [`scratchpad-entry:${'0'.repeat(64)}`],
  }, childPrincipal, null));
  assert.equal(unknownTask?.code, 'application_unauthorized');
  // Cross-run task (task exists but its runId differs from args.runId): the same constant.
  const foreignHandle = await spawnMember(fx, { runId: 'run:p7-foreign' });
  const foreignTask = fx.coordination.task(foreignHandle.taskId);
  const crossRun = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: 'run:p7-parent', taskId: foreignTask.id, entryIds: [`scratchpad-entry:${'0'.repeat(64)}`],
  }, childPrincipal, null));
  assert.equal(crossRun?.code, 'application_unauthorized');
  assert.equal(crossRun?.message, unknownTask?.message, 'unknown ≡ cross-run at the seam — no existence leak');
  // attention.watch foreign run: the lane's OWN landed law — attention_scope_forbidden.
  const foreignWatch = await facadeError(() => fx.application.command('run.attention.watch', {
    runId: 'run:p7-foreign',
  }, childPrincipal, null));
  assert.equal(foreignWatch?.code, 'attention_scope_forbidden');
});

// ===========================================================================
// Section R — reds (each fails today at its named stage).
// ===========================================================================









// The legacy families under test, with transport-valid envelopes (validateEnvelope-closed
// shapes) so today's refusal-absent behavior is a genuine 200 admission per family.
function legacyFamilies(label) {
  const workerId = `worker-${label}`;
  return [
    { command: 'spawn', args: { harness: 'mock', brief: { goal: 'x' } }, runId: `run-${label}-spawn` },
    { command: 'send', args: { workerId, message: 'm', mode: 'turn' }, runId: `run-${label}-send`, extra: { expectedFence: 1 } },
    { command: 'interrupt', args: { workerId, then: 'continue' }, runId: `run-${label}-interrupt`, extra: { expectedFence: 1 } },
    { command: 'kill', args: { workerId }, runId: `run-${label}-kill`, extra: { expectedFence: 1 } },
    { command: 'drain', args: {}, runId: `run-${label}-drain` },
    { command: 'respond', args: { requestId: 'req-1', answer: { ok: true } }, runId: `run-${label}-respond` },
    {
      command: 'capability_invoke',
      args: { action: 'invoke', name: 'read', op: 'read', args: {}, budgetTokens: 100 },
      runId: `run-${label}-capability`,
    },
  ].map(({ command, args, runId, extra = {} }) => ({ command, args, runId, extra }));
}
