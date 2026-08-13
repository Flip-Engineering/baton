// Issue #74 — the worker-orchestrated swarm rung. Red-first acceptance suite for the folded
// #74 contract v1.2 (the heavy coordinator member over cheap swarm rows, coordinated through the
// collaboration lanes — scratchpad read/elevate, boards, messages, DECISION_REQUEST — never
// driving baton itself).
//
// Binding contract: docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/
//   contract-fold.md v1.2 (source of truth), worker-orchestrated-swarm-contract.md v1.0,
//   contract-redteam.md — the A1-A10 acceptance pins, the D1/D1.2/D1.3/D1.4/D2/D3/D4 folded
//   laws, the refusal vocabulary, and the pre-gate dispatch-order finding (the waves.* direct
//   ports dispatch BEFORE the recursive-session gate — the ORDER, not absolute lines). Idioms:
//   workflow-as-data-red.test.mjs
//   (the fixture machinery this suite drives through `waves.run` — which EXISTS at HEAD), and
//   wave-observability-red.test.mjs / trust-gate-steering-red.test.mjs.
//
// Rows: 16 (8 red + 8 green/pin). Red-first: every red row fails today at a NAMED stage —
//   coordinator-read-law-missing / read-law-missing / steering-trail-falsified /
//   coordinator-authority-forbidden-missing / seat-route-hidden / composition-example-refused /
//   file-not-directory-law-missing — and goes green on the contract's implementation ONLY. The
//   eight green/pin rows (P-A4, P-A5-static, P-A7, P-A8-dir, P-A9, P-A10, P-D1.4, P-A3g) pin the
//   substrate the #74 rung builds on; they MUST stay green.
//
// Invented surfaces (all absent at HEAD; namespace-proof access so a missing code never kills
// the file at LOAD):
//   * the restricting authorize at the deployment seam (D1.2) — installed by the FIXTURE as the
//     stand-in for the deployment seam (the fixture bypasses application-deployment.mjs), with a
//     STATIC red pin on the real seam: a sibling `worker:<role>` read draws
//     `application_unauthorized`; the permissive `authorize: async () => true` must be gone
//   * the truthful denied/raced answer record (D1.3) — `{outcome:'denied', refusal:<code>,
//     optionId?}` with the decision key NOT handled before the attempt (structural pin) and the
//     ask left pending (exactly one denied record, never re-auto-answered)
//   * the `coordinator_authority_forbidden` refusal at the waves.* authority boundary (D2/A5)
//   * the coordinator route exposed in the `waves.list` roster (D3/A6) — the seat map
//   * the v1.1 example spec's `kind:'brief'` / `kind:'result'` in the steering policy (D4/A8) —
//     asserted at DELIVERY (a messageOnSpawn messageId + the signalOnMembersDone recipients)
//   * the file-not-directory harvest law (D4) — a directory path WITHOUT mustContain must refuse
//     harvest_miss (the D4 §4.3 fold)
//
// Everything else the suite drives through surfaces that EXIST at HEAD: `waves.run`
// (application.mjs:12516), `waves.start` (:12506), `waves.list` (:12512), `run.scratchpad.read`
// (dispatch :12474), `run.answer`, `runs.list`, and the standalone `implementContractRecipe`
// (recipes.mjs:549). The `deployment.doctor` wave-driver preflight is NOT reachable in a minimal
// BatonApplication fixture, so the recipe cadence is asserted at the admission seam only (the
// driver cadence itself is documented in suite-draft-notes.md).
//
// RED/GREEN split at HEAD 3dd4143 (recorded after TWO consecutive runs from the repo root;
// `node --test impl/test/worker-orchestrated-swarm-red.test.mjs` — 16 rows, 8 pass / 8 fail,
// identical across both runs):
//   RED   8 — A1, A2, A3, A3b, A5, A6, A8, A8-dir   (each fails at its named stage)
//   GREEN 8 — P-A4, P-A5-static, P-A7, P-A8-dir, P-A9, P-A10, P-D1.4, P-A3g
//
// NUL discipline: application.mjs / coordination-store.mjs carry NUL bytes, so the static
// source pins use execFileSync grep -an/sed -n — never whole-file reads. Node imports of the
// NUL-bearing src modules are fine (the byte strings are in literals).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import { implementContractRecipe } from '../src/recipes.mjs';
import { WAITING_ON_KINDS } from '../src/application-semantics.mjs';

// ---------------------------------------------------------------------------
// Constants (closed, byte-stable — the fixture's stand-in for the operator's
// deployment profile; the heavyweight coordinator seat and the cheap swarm rows
// are both admissible so the D3 seat map can ride the exact-route admission).
// ---------------------------------------------------------------------------

const REPO = 'repo-s74';
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 });

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const HEAVY_ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model-heavy', effort: 'high' });

const PROFILE = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  definitionOfDone: ['verification passes'],
  constraints: [],
  risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000,
    maxOutputBytes: 65536, requiredPredecessorEvidence: [],
  },
  // The D3 seat map: the heavyweight coordinator seat (mock-model-heavy) and the
  // cheap swarm rows (mock-model) are BOTH in the deployment profile, so each
  // member rides the SAME exact-route profile admission ordinary run.start uses.
  routes: [
    { harness: 'mock', model: 'mock-model', effort: 'low' },
    { harness: 'mock', model: 'mock-model-heavy', effort: 'high' },
  ],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  mandatory: true,
  approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// ---------------------------------------------------------------------------
// Adapter machinery (from the workflow-as-data idiom): a scenario-keyed MockAdapter
// that carries the interpreter's `[attempt: <salt>]` line onto every edit so the D4
// harvest marker check passes, plus a decision scenario for the DECISION_REQUEST lane.
// ---------------------------------------------------------------------------

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-s74-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

class CarryAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this.calls = { spawn: [], approve: [], answer: [], prompt: [] };
  }
  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact',
        configuredDefault: 'mock-model',
        available: ['mock-model', 'mock-model-heavy'],
        family: 'mock',
        acceptedPrefixes: [],
        acceptedAliases: [],
        reasoningEffort: ['low', 'high'],
        serviceTier: null,
        provenance: 'worker-orchestrated-swarm-red.test.mjs',
        refreshedAt: null,
      },
    };
  }
  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }
  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker] ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    this.calls.spawn.push({ worker, marker, brief });
    if (scenario.carryAttemptMarker) {
      this._carryMarker = this._carryMarker ?? new Map();
      const goal = brief?.goal ?? '';
      const salt = /^\[attempt: [^\]]+\] /u.exec(goal);
      this._carryMarker.set(worker, salt ? salt[0] : '[attempt: missing] ');
    }
    return super.spawn(worker, brief, { ...options, scenario });
  }
  async _applyEdit(session, edit) {
    const salt = this._carryMarker?.get(session.worker);
    if (salt) edit = { ...edit, content: `${salt}${edit.content}` };
    return super._applyEdit(session, edit);
  }
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    return super.answer(worker, requestId, answer);
  }
  async prompt(worker, content, mode = 'turn') {
    // Ledger the coordinator's delivery frames (`[MESSAGE <kind> <messageId> — UNTRUSTED]`) so
    // the A8 delivery assertions can prove the coordinator boundary accepted `brief`/`result`
    // end-to-end (workflow-as-data F3 idiom), not just the interpreter's closed kind set.
    this.calls.prompt.push({ worker, message: content, mode });
    return super.prompt(worker, content, mode);
  }
}

// A delivery-race adapter: answer() throws a typed code (the D1.3 "raced a terminal
// member" path), so the interpreter's `handle.answer` swallows a REAL throw — exactly
// the case the contract says must record the truth, never `outcome:'answered'`.
class RefusingAnswerAdapter extends CarryAdapter {
  constructor({ refusalCode = 'application_run_stopped', ...config } = {}) {
    super(config);
    this.refusalCode = refusalCode;
    this.thrown = [];
  }
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    const error = Object.assign(new Error(this.refusalCode), { code: this.refusalCode });
    this.thrown.push({ worker, requestId, code: this.refusalCode });
    throw error;
  }
}

const decisionScenario = (marker, overrides = {}) => ({
  outcome: 'completed',
  edits: [{ path: `reports/${marker}.md`, content: `${marker} report\n` }],
  ask: {
    kind: 'decision',
    question: 'Which path?',
    options: [
      { id: 'opt-a', label: 'A', summary: null },
      { id: 'opt-b', label: 'B', summary: null },
    ],
    allowFreeResponse: false,
    recommended: null,
    deadlineMs: 120000,
    afterEditIndex: 1,
    onAnswerEdits: [{ path: `reports/${marker}-after.md`, content: `${marker} after answer\n` }],
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// The D1.2 read-law authorize (fold §1.1): the restricting authorize the contract requires
// any coordinator-member deployment to install at the authorize seam (D1.2 — the deployment
// seam the fixture bypasses, application-deployment.mjs:2012). `shared` always reads; the top
// orchestrator (s74-owner, the review authority FP-18) reads any `worker:*` scope of its own
// wave; a swarm row reads a `worker:<role>` partition ONLY through an explicit wave-scoped
// grant (grantedScopes, D1.2 point 3) or `shared` — any other sibling `worker:<role>` read
// returns false → `application_unauthorized` at application.mjs:3215. The grant map mints the
// wave-scoped grant so the A2 grant path is REACHABLE (fold §2.2 — a refuse-everything
// restrictor would fail that green leg).
// ---------------------------------------------------------------------------

function restrictingReadAuthorize({ grantedScopes = new Map() } = {}) {
  return async ({ command, principal, subject }) => {
    if (command !== 'run.scratchpad.read') return true;
    const scope = subject?.scope;
    if (typeof scope !== 'string' || !scope.startsWith('worker:')) return true; // shared + non-worker scopes always read
    if (principal?.principalId === 's74-owner') return true; // the top orchestrator (review authority, D1.2 pt 2)
    if (grantedScopes.get(principal?.principalId)?.has(scope)) return true; // an explicit wave-scoped grant (D1.2 pt 3)
    return false; // a sibling `worker:<role>` read → application_unauthorized
  };
}

// ---------------------------------------------------------------------------
// Fixture (from the workflow-as-data idiom): a minimal BatonApplication bound to a
// per-test temp git repo, a scenario-keyed mock adapter, and a parameterized
// authorize seam. Driving `waves.run` exists at HEAD (application.mjs:12516); the
// recipe cadence is asserted at the admission seam only (deployment.doctor is not
// reachable in this minimal fixture — see suite-draft-notes.md).
// ---------------------------------------------------------------------------

async function fixture(t, { authorize = async () => true, adapter = null } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'results'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  mkdirSync(join(repo, 'rows'), { recursive: true });
  const coordAdapter = adapter ?? new CarryAdapter({ harness: 'mock', scenariosByMarker: { default: { outcome: 'completed' } } });
  const driver = createDriver({
    repoRoot: repo,
    repoId: REPO,
    logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('s74-planner'),
      dispatcher: principalOf('s74-dispatcher'),
      observer: principalOf('s74-observer'),
    },
    authorize,
  });
  await application.ready;
  const baton = bindBaton(application, principalOf('s74-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('s74-cleanup')); } catch {}
    try { await driver.coordination?.releaseWriterLease?.(); } catch {}
    try { await driver.closeAuthority?.(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter: coordAdapter };
}

function member(role, overrides = {}) {
  return {
    role,
    exact: { ...ROUTE },
    scope: ['reports/**'],
    objectiveRef: `objectives/${role}.md`,
    report: `reports/${role}.md`,
    ...overrides,
  };
}

function writeObjective(repo, role, text) {
  const path = join(repo, 'objectives', `${role}.md`);
  writeFileSync(path, `${text}\n(marker:${role})\n`);
  return path;
}

function writeRowBrief(repo, role, text) {
  const path = join(repo, 'rows', `${role}.md`);
  writeFileSync(path, `${text}\n(marker:${role})\n`);
  return path;
}

async function runsFor(repo) {
  // listRuns needs a principal; called with the owner.
  const owner = principalOf('s74-owner');
  const app = repo.application;
  return app.command('runs.list', {}, owner);
}

// NUL-safe static source pin: grep -an a file and return {line, text} for the
// first match (execFileSync handles the NUL bytes in application.mjs etc.).
function srcAnchor(file, pattern) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const out = execFileSync('/usr/bin/grep', ['-an', pattern, join(root, file)], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean);
  if (out.length === 0) throw new Error(`source anchor ${file} ~ ${pattern} not found`);
  const first = out[0];
  const colon = first.indexOf(':');
  return { line: Number(first.slice(0, colon)), text: first.slice(colon + 1) };
}

// Drift-immune awk range: the `driveLane` function body — the region between `async function
// driveLane` and the next TOP-LEVEL function (`^(async )?function `; the nested `processMember`
// stays inside). No absolute line windows (the blue-team §3.2 ruling): a counter sneaking into
// processMember/answerDecision, or a pre-answer `s.answeredKeys.add`, cannot escape the scan.
function driveLaneBody() {
  return execFileSync('/usr/bin/awk', [
    '/^async function driveLane/{scan=1} scan && /^(async )?function / && !/^async function driveLane/{exit} scan{print}',
    fileURLToPath(new URL('../src/workflow-interpreter.mjs', import.meta.url)),
  ], { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// GREEN / PIN rows (must stay green at HEAD)
// ---------------------------------------------------------------------------

test('P-A4 pin: a coordinator-seat worker has NO baton connection — discovery fails with the byte-identical absence refusal', () => {
  // D2/A4: a coordinator-seat worker holds no baton connection, so its discovery
  // fails with the absence refusal `cli_config_invalid: user connection profile is
  // unavailable` — byte-identical to #12 (application-cli.mjs:126, label :257).
  const repo = mkdtempSync(join(tmpdir(), 'baton-s74-a4-repo-'));
  const git = join(repo, '.git');
  mkdirSync(join(git, 'baton'), { recursive: true });
  // The repository authority references a profile that is NOT present — the
  // coordinator seat's missing connection.
  writeFileSync(join(git, 'baton', 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: 'default', repoId: 'repo-s74-a4',
  }));
  const home = mkdtempSync(join(tmpdir(), 'baton-s74-a4-home-'));
  mkdirSync(join(home, 'config', 'baton', 'connections'), { recursive: true });
  try {
    assert.throws(
      () => discoverBatonConnection({
        cwd: repo,
        env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') },
        home,
      }),
      (error) => error?.code === 'cli_config_invalid'
        && error?.message === 'user connection profile is unavailable',
      'coordinator-seat discovery must draw the byte-identical absence refusal',
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  // Byte-stable source anchor: readBoundedFile throws `${label} is unavailable` with
  // cli_config_invalid at :126; the label 'user connection profile' is passed at the
  // :257 call site through readConnectionJson (:149). grep -an only (NUL-bearing file).
  const unavailable = srcAnchor('application-cli.mjs', "is unavailable");
  assert.ok(unavailable.line >= 124 && unavailable.line <= 128, 'readBoundedFile throw anchor');
  assert.ok(unavailable.text.includes('cli_config_invalid'), 'code byte-stable');
  const profileLabel = srcAnchor('application-cli.mjs', 'user connection profile');
  assert.ok(profileLabel.text.includes("'user connection profile'"), 'label literal');
  const readConn = srcAnchor('application-cli.mjs', 'function readConnectionJson');
  assert.ok(readConn.line >= 147 && readConn.line <= 152, 'readConnectionJson def anchor (:149)');
  assert.ok(profileLabel.line >= 255 && profileLabel.line <= 259, 'label call site anchor (:257)');
});

test('P-A5-static pin: waves.* direct ports dispatch BEFORE the recursive-session gate; #12 codes are NOT claimed for waves.* verbs', () => {
  // D2 / A5 (OQ1 answered): the waves.* direct ports (waves.start, waves.list, waves.run)
  // dispatch BEFORE the gate's context?.sessionAuthority check and
  // run_orchestrator_command_forbidden throw. A lease-bound coordinator reaching
  // waves.start is therefore not refused by the recursive gate; the only gate is the
  // per-member run.start admission. The suite pins the ORDER — the load-bearing alarm
  // (a future widening moving waves.* after the gate, or a port becoming a definitions
  // entry, is caught by the ORDER/EXISTENCE anchors). Tight absolute line windows are
  // dropped per the blue-team §3.2 ruling (drift-tolerant pins; a normal landing never
  // re-bases them).
  const start = srcAnchor('application.mjs', "name === 'waves.start'");
  const list = srcAnchor('application.mjs', "name === 'waves.list'");
  const run = srcAnchor('application.mjs', "name === 'waves.run'");
  // The gate throw itself — the single-line form with the code on the same line is UNIQUE
  // to the recursive-session gate (the :12137 occurrence is a two-line split inside a
  // different context gate). The marker string doubles as the byte-string existence pin.
  const gate = srcAnchor('application.mjs', "throw applicationError('recursive Run command is forbidden', 'run_orchestrator_command_forbidden');");
  assert.ok(list.line > start.line, 'waves.start dispatches before waves.list (the direct-port ORDER)');
  assert.ok(run.line > list.line, 'waves.list dispatches before waves.run (the direct-port ORDER)');
  assert.ok(gate.line > run.line, 'recursive gate dispatches AFTER the waves.* ports');
  assert.ok(gate.text.includes('run_orchestrator_command_forbidden'), 'the gate throw byte-string stays');
  const notInDefinitions = srcAnchor('application.mjs', 'NOT APPLICATION_COMMAND_DEFINITIONS entries');
  assert.ok(notInDefinitions.line < start.line, 'the direct-port comment precedes the waves.* dispatch');
});

test('P-A7 pin: capacity honesty — WAITING_ON_KINDS stays the byte-unchanged closed five; the run view carries the honest single waitingOn projection (null when not waiting)', async (t) => {
  // D3/A7: the coordinator\'s waitingOn projects through the standard single
  // projection; WAITING_ON_KINDS stays the byte-unchanged closed five
  // (application-semantics.mjs:59-63).
  assert.deepEqual(
    [...WAITING_ON_KINDS].sort(),
    ['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning'],
    'WAITING_ON_KINDS is the closed five',
  );
  // Behavioral: run a member; its inspect view carries a SINGLE `waitingOn` key that
  // is exactly null (mid-turn honest null — no fabricated 'working').
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a7-honest-null',
    members: [member('coordinator')],
    steering: {},
    harvest: { paths: [] },
  };
  await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  const runs = await runsFor(fx);
  const runId = runs.items?.[0]?.id;
  assert.ok(typeof runId === 'string' && runId.startsWith('run-'), 'wave member run registered');
  // The waitingOn projection rides the SAME phase/task/worker view run.status carries
  // (application.mjs:7326, :7799); a settled member projects the honest single null.
  const status = await fx.application.command('run.status', { runId }, principalOf('s74-owner'));
  const waitingKeys = Object.keys(status).filter((key) => key === 'waitingOn');
  assert.deepEqual(waitingKeys, ['waitingOn'], 'single waitingOn projection');
  assert.equal(status.waitingOn, null, 'honest null — a settled member is not waiting');
});

test('P-A8-dir pin: a DIRECTORY harvest path lands harvest_miss → WAVE-INCOMPLETE with basis = the manifest digest', async (t) => {
  // D4: the harvest path names a FILE, never a directory. The v1.2 mechanism (blue-team §4.3):
  // `git show <sha>:<dir>` RETURNS the tree listing and exits 0 (it does NOT fail), so a
  // directory with a `mustContain` only refuses because the recovered listing fails the
  // mustContain check → harvest_miss → WAVE-INCOMPLETE (honest, typed). The structural
  // file-not-directory enforcement — refusing a directory regardless of mustContain — is
  // the A8-dir RED row below; THIS pin keeps the refusal-shape/basis relation green.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a8-dir',
    members: [member('coordinator')],
    steering: {},
    harvest: { paths: [{ path: 'reports', mustContain: 'coordinator report' }] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.equal(receipt.verdict, 'WAVE-INCOMPLETE', 'a directory harvest refuses honestly');
  assert.ok(receipt.harvest.every((entry) => entry.missed === true && entry.code === 'harvest_miss'), 'harvest_miss entries');
  assert.equal(typeof receipt.basis, 'string', 'basis present');
  assert.equal(receipt.basis, receipt.manifestDigest, 'basis = the manifest digest on an incomplete wave');
});

test('P-A9 pin: the D6 receipt is the closed seven-key shape — outcomes audit-shaped for the sub-orchestrator, no new surface', async (t) => {
  // D1/A9/G5: the top orchestrator audits the D6 receipt `outcomes` (per-member
  // {role, phase, terminal, resultSha, report?}), the steering trail, and verdict/basis —
  // EXACTLY seven sorted keys {basis, harvest, manifestDigest, outcomes, steering,
  // verdict, waveId} (workflow-interpreter.mjs:594-602). No new receipt surface.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
        'row-1': { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/row-1.md', content: 'row-1 report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  writeObjective(fx.repo, 'row-1', 'write the row-1 report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a9-receipt',
    members: [
      member('coordinator', { exact: { ...HEAVY_ROUTE } }),
      member('row-1'),
    ],
    steering: {},
    harvest: {
      paths: [
        { path: 'reports/coordinator.md', mustContain: 'coordinator report' },
        { path: 'reports/row-1.md', mustContain: 'row-1 report' },
      ],
    },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.deepEqual(
    Object.keys(receipt).sort(),
    ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'],
    'D6 receipt is EXACTLY the seven sorted keys',
  );
  assert.equal(receipt.verdict, 'WAVE-OK', 'coordinator + row both settle with FILE harvests');
  // D6: a WAVE-OK receipt\'s basis is the completion literal; a WAVE-INCOMPLETE receipt\'s
  // basis is the manifest digest (pinned in P-A8-dir). The audit reads both truthfully.
  assert.equal(receipt.basis, 'completed', 'WAVE-OK basis is the completion literal');
  assert.ok(Array.isArray(receipt.outcomes), 'outcomes is an array');
  assert.equal(receipt.outcomes.length, 2, 'one outcome per member');
  for (const outcome of receipt.outcomes) {
    assert.ok(['coordinator', 'row-1'].includes(outcome.role), `per-row role ${outcome.role}`);
    assert.equal(outcome.terminal, true, `${outcome.role} settled`);
    assert.equal(typeof outcome.resultSha, 'string', `${outcome.role} result sha materialized`);
    assert.equal(typeof outcome.report, 'string', `${outcome.role} report path carried`);
  }
  const coordinator = receipt.outcomes.find((outcome) => outcome.role === 'coordinator');
  assert.equal(coordinator.phase, 'work_completed', 'heavy coordinator settles');
});

test('P-A10 pin: refusal constancy — the facade capability refusal, the closed five, the #105 boundary, and the reply frame stay byte-unchanged; no sorted-key literal, no clock in any refusal', () => {
  // A10: the facade capability refusal stays `application_unauthorized`
  // (application.mjs:3215); the closed five WAITING_ON_KINDS and the #105 boundary
  // (the `message_depth_exceeded` refusal site, the reply frame 'body,inReplyTo' at
  // claude-session.mjs:161) are byte-unchanged; the D6 receipt adds no sorted-key
  // literal; no clock enters any refusal. Per the blue-team §3.2 ruling the pins are
  // EXISTENCE + byte-string (srcAnchor throws if a marker disappears), never tight
  // absolute line windows — a normal landing does not re-base them.
  assert.deepEqual([...WAITING_ON_KINDS].sort(), ['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning']);
  const authz = srcAnchor('application.mjs', 'application command is not authorized');
  assert.ok(authz.text.includes("'application_unauthorized'"), 'facade capability refusal byte-stable');
  const depth = srcAnchor('coordinator.mjs', 'message_depth_exceeded');
  assert.ok(depth.text.includes("'message_depth_exceeded'"), '#105 boundary byte-stable (the depth-refusal site)');
  const frame = srcAnchor('claude-session.mjs', 'body,inReplyTo');
  assert.ok(frame.text.includes("'body,inReplyTo'"), 'reply frame closed keys byte-stable');
  // No clock enters a refusal: the interpreter\'s workflow_* and the authorize seam
  // messages are literal (no Date/now interpolation in the refusal construction).
  const dateLines = execFileSync('/usr/bin/grep', ['-n', 'Date.now\\|Date(', fileURLToPath(new URL('../src/workflow-interpreter.mjs', import.meta.url))], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const line of dateLines) {
    assert.ok(!line.includes('workflowError') && !line.includes("'workflow_"), `no clock inside an interpreter refusal: ${line.trim()}`);
  }
  // The D6 receipt key-set pin is P-A9 (behavioral); the interpreter\'s receipt build
  // writes the seven keys as an OBJECT LITERAL (workflow-interpreter.mjs:595-603) — scan
  // the return block to prove no computed/assembled sorted-key list is introduced.
  const returnBlock = execFileSync('/usr/bin/grep', [
    '-A6', '-n', '^    basis,$',
    fileURLToPath(new URL('../src/workflow-interpreter.mjs', import.meta.url)),
  ], { encoding: 'utf8' }).trim();
  for (const key of ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId']) {
    assert.ok(returnBlock.includes(`    ${key},`), `D6 receipt return carries ${key} literally`);
  }
});

test('P-D1.4 pin/comment-row: the escalation sequence is concurrency-bounded and sequentially uncapped — no hardcoded iteration counter enters driveLane', () => {
  // D1.4: the interpreter\'s decision-answer loop is bounded by CONCURRENCY (the
  // roster, ≤64 members, polled in parallel) and by the driver\'s wall-clock hardCap,
  // sequentially UNCAPPED — the human-in-loop answer sequence never hits an arbitrary
  // numeric iteration cap. This is a comment-row + structural pin: the while loop must
  // stay a clock/concurrency bound, never a counter. Per the blue-team §4.1 the counter
  // scan covers the WHOLE driveLane body — the region between `async function driveLane`
  // and the next top-level function (drift-immune awk range, no absolute line windows) —
  // not just the matched loop line, so a counter inside processMember/answerDecision
  // cannot escape.
  const laneBody = driveLaneBody();
  assert.match(laneBody, /pending\.size > 0/, 'loop runs until no pending member');
  assert.match(laneBody, /Date\.now\(\) - startedAt < driver\.hardCapMs/, 'loop is wall-clock bounded only');
  assert.doesNotMatch(laneBody, /attempts\s*<\s*[0-9]+|counter|iteration/, 'no numeric iteration cap anywhere in the driveLane body');
  // Existence: the receipt verdict literals stay (srcAnchor throws if a marker disappears;
  // the D1.4 pin owns the loop bound, the receipt shape is P-A9/P-A10\'s).
  const verdict = srcAnchor('workflow-interpreter.mjs', "'WAVE-OK'");
  assert.ok(verdict.text.includes('WAVE-OK'), 'receipt verdict literal stays');
});

test('P-A3g green guard: a DELIVERED decision answer records outcome \'answered\' and settles the member (the machinery works when not denied)', async (t) => {
  // The A3 green side, pinned: a coordinator DECISION_REQUEST answered by
  // answerDecisions.policy records `outcome: 'answered'` ONLY after handle.answer
  // returns successfully (workflow-interpreter.mjs:806-808) — the onAnswerEdits land.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: { coordinator: decisionScenario('coordinator', { carryAttemptMarker: true }) },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a3g-delivered',
    members: [member('coordinator')],
    steering: { answerDecisions: { policy: { 'Which path?': 'opt-a' } } },
    harvest: { paths: [] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.equal(receipt.verdict, 'WAVE-OK', 'delivered answer settles the wave');
  const delivered = receipt.steering.find((entry) => entry.trigger === 'answerDecisions');
  assert.ok(delivered, 'an answerDecisions record exists');
  assert.equal(delivered.outcome, 'answered', 'delivered answer records answered');
  assert.equal(delivered.optionId, 'opt-a', 'the policy option is recorded');
  assert.equal(fx.adapter.calls.answer.length, 1, 'the answer command reached the member');
});

// ---------------------------------------------------------------------------
// RED rows (must FAIL at HEAD at the named stage)
// ---------------------------------------------------------------------------

test('A1 red: the coordinator-member recipe admits, but the deployment seam still installs the PERMISSIVE authorize — the D1.2 read law is not enforced (coordinator-read-law-missing)', async (t) => {
  // D1/A1: the implementContract preset admits `role: 'coordinator'` as an ordinary member
  // with no distinguishable semantics. Fold §1.1 (blocker): the A1/A2 fixtures must install the
  // suite's invented restricting authorize (D1.2's seam stand-in) so the sibling-refusal legs are
  // REACHABLE after a correct impl — the permissive fixture would keep them red forever. The
  // behavioral legs below prove the law HOLDS when the restrictor is present (GREEN at HEAD), and
  // the RED moves to the REAL seam: the permissive `authorize: async () => true` must be GONE
  // from application-deployment.mjs — any deployment running the coordinator-member recipe must
  // install the restricting authorize there (D1.2).
  // GREEN — recipe admission (closed recipe fields unchanged, role + heavy route kept).
  const recipe = implementContractRecipe({
    task: 'coordinate the swarm', route: HEAVY_ROUTE, scope: ['reports/**'], role: 'coordinator',
  });
  assert.deepEqual(Object.keys(recipe).sort(), ['members', 'name', 'policy', 'version'], 'closed recipe fields (G6)');
  assert.equal(recipe.members.length, 1, 'single-member recipe');
  assert.equal(recipe.members[0].role, 'coordinator', 'coordinator role preserved');
  assert.deepEqual(recipe.members[0].exact, HEAVY_ROUTE, 'heavyweight exact route preserved');
  // GREEN — with the restricting authorize installed at the deployment-seam stand-in, the
  // coordinator's wave ENFORCES the D1.2 read law: the top orchestrator reads its coordinator's
  // partition (D1.2 pt 2), a sibling read of `worker:coordinator` refuses application_unauthorized
  // (D1.2 pt 1/3). Both pass at HEAD — the fixture restrictor IS the law, hermetically.
  const fx = await fixture(t, {
    authorize: restrictingReadAuthorize(),
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a1-recipe',
    members: [member('coordinator', { exact: { ...HEAVY_ROUTE } })],
    steering: {},
    harvest: { paths: [] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  const coordinatorOutcome = receipt.outcomes.find((outcome) => outcome.role === 'coordinator');
  assert.ok(coordinatorOutcome, 'the coordinator\'s per-row outcome rides the D6 receipt');
  assert.equal(coordinatorOutcome.terminal, true, 'coordinator settled');
  const runs = await runsFor(fx);
  const coordinatorRunId = runs.items?.find((item) => item.objective?.includes('(marker:coordinator)'))?.id;
  assert.ok(typeof coordinatorRunId === 'string', 'coordinator run registered');
  const ownerRead = await fx.application.command(
    'run.scratchpad.read', { runId: coordinatorRunId, scope: 'worker:coordinator' }, principalOf('s74-owner'),
  );
  assert.ok(ownerRead, 'the top orchestrator reads the coordinator partition (D1.2 pt 2)');
  await assert.rejects(
    fx.application.command('run.scratchpad.read', { runId: coordinatorRunId, scope: 'worker:coordinator' }, principalOf('s74-sibling')),
    (error) => error?.code === 'application_unauthorized',
    'a sibling read of the coordinator\'s `worker:coordinator` partition must be refused (D1.2 pt 3)',
  );
  // RED — the REAL deployment seam is STILL permissive at HEAD. The precise pattern
  // `^[[:space:]]*authorize: async () => true,` matches ONLY the seam literal
  // (application-deployment.mjs:2012), never the :2044 comment that quotes it — so the pin goes
  // green exactly when the restrictor replaces the permissive literal. At HEAD the literal is
  // present → the row is RED at `coordinator-read-law-missing`.
  const seam = execFileSync('/usr/bin/sed', ['-n', '/^[[:space:]]*authorize: async () => true,/p', fileURLToPath(new URL('../src/application-deployment.mjs', import.meta.url))], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n').filter(Boolean);
  assert.equal(seam.length, 0,
    'the permissive `authorize: async () => true` must be absent from the deployment seam (D1.2 requires the restricting authorize here)');
});

test('A2 red: the D1.2 read law is missing at the deployment seam — the permissive authorize persists, and the only swarm-row route to the coordinator is the wave-scoped grant (read-law-missing)', async (t) => {
  // D1.2/A2: the read law governs who may read a `worker:<role>` partition — a member reads
  // `worker:<ownId>` + `shared`; a sibling `worker:<role>` read is REFUSED with the typed code; a
  // swarm row reads the coordinator's sub-specs ONLY through an explicit wave-scoped grant or
  // `shared` (D1.2 pt 3). Fold §1.1: the fixture installs the grant-aware restricting authorize
  // (the seam stand-in), so the sibling-refusal leg is REACHABLE after a correct impl. Fold §2.2:
  // the wave-scoped grant path is asserted REACHABLE — a grant-aware restrictor mints an explicit
  // grant and a granted swarm-row read SUCCEEDS, so a refuse-everything restrictor (one with no
  // grant surface) FAILS. The RED is the REAL seam: the permissive literal must be gone.
  const grantedScopes = new Map([['s74-sibling', new Set(['worker:coordinator'])]]);
  const fx = await fixture(t, {
    authorize: restrictingReadAuthorize({ grantedScopes }),
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a2-readlaw',
    members: [member('coordinator')],
    steering: {},
    harvest: { paths: [] },
  };
  await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  const runs = await runsFor(fx);
  const coordinatorRunId = runs.items?.find((item) => item.objective?.includes('(marker:coordinator)'))?.id;
  assert.ok(typeof coordinatorRunId === 'string', 'coordinator run registered');
  // GREEN — the member\'s OWN scope (`worker:coordinator`, the wave role it owns) reads (D1.2 pt 1).
  const ownRead = await fx.application.command(
    'run.scratchpad.read', { runId: coordinatorRunId, scope: 'worker:coordinator' }, principalOf('s74-owner'),
  );
  assert.ok(ownRead, 'own-scope read succeeds');
  // GREEN — the `shared` layer reads (D1.2 pt 1/3).
  const sharedRead = await fx.application.command(
    'run.scratchpad.read', { runId: coordinatorRunId, scope: 'shared' }, principalOf('s74-sibling'),
  );
  assert.ok(sharedRead, 'shared read succeeds');
  // GREEN — a GRANTED swarm row reads the coordinator\'s `worker:coordinator` partition (D1.2 pt 3).
  // The fixture-level restrictor minted the explicit wave-scoped grant for `s74-sibling`; this leg
  // asserts the grant path is REACHABLE (fold §2.2 — over-refusal must fail).
  const grantedRead = await fx.application.command(
    'run.scratchpad.read', { runId: coordinatorRunId, scope: 'worker:coordinator' }, principalOf('s74-sibling'),
  );
  assert.ok(grantedRead, 'a wave-scoped grant admits the swarm-row read (D1.2 pt 3)');
  // RED — a sibling WITHOUT a grant refuses `application_unauthorized` (the fixture restrictor is
  // installed, so this behavioral leg passes at HEAD; it pins the refusal shape of the law).
  await assert.rejects(
    fx.application.command('run.scratchpad.read', { runId: coordinatorRunId, scope: 'worker:coordinator' }, principalOf('s74-sibling-other')),
    (error) => error?.code === 'application_unauthorized',
    'a sibling `worker:<role>` read without a grant must be refused with the typed code (D1.2)',
  );
  // RED — the REAL deployment seam is STILL permissive at HEAD (the same literal A1 pins; this row
  // owns the general read-law angle, A1 owns the coordinator-partition angle). The pattern matches
  // ONLY the seam literal (application-deployment.mjs:2012), never the :2044 comment.
  const seam = execFileSync('/usr/bin/sed', ['-n', '/^[[:space:]]*authorize: async () => true,/p', fileURLToPath(new URL('../src/application-deployment.mjs', import.meta.url))], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n').filter(Boolean);
  assert.equal(seam.length, 0,
    'the permissive `authorize: async () => true` must be absent from the deployment seam (D1.2)');
});

test('A3 red: a DENIED decision answer is recorded as outcome \'answered\' and the key is still marked handled — the steering trail is falsified (steering-trail-falsified)', async (t) => {
  // D1.3/A3: the answering path swallows `handle.answer` throws and records
  // `{outcome: 'answered'}` unconditionally (workflow-interpreter.mjs:794-808), and the
  // decision key is marked handled BEFORE the attempt (:698). The contract requires the
  // truth: a denied answer records `{outcome: 'denied', refusal: <code>, optionId?}` (fold
  // §1.2a — the audit needs the attempted option), does NOT mark the key handled (fold
  // §2.1 — permanence), and records a denied ask ONCE, never re-auto-answered (fold
  // §1.2c — the re-attempt policy). At HEAD the swallowed throw is masked AND the key is
  // handled pre-attempt — this row is RED at `steering-trail-falsified`.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: { coordinator: decisionScenario('coordinator', { carryAttemptMarker: true }) },
    }),
    authorize: async ({ command, principal }) => !(command === 'run.answer' && principal?.principalId === 's74-owner'),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a3-denied',
    members: [member('coordinator')],
    steering: { answerDecisions: { policy: { 'Which path?': 'opt-a' } } },
    harvest: { paths: [] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  // The truthful single-denied trail shape (fold §1.2c): exactly ONE denied record per requestId,
  // no later answered for the same requestId. At HEAD the record is `{outcome: 'answered'}`
  // (swallowed `application_unauthorized`) → the count is 0 → the assertion FAILS → RED.
  const deniedRecords = receipt.steering.filter((entry) => entry.trigger === 'answerDecisions' && entry.outcome === 'denied');
  assert.equal(deniedRecords.length, 1, 'exactly one denied record — a denied ask is never re-auto-answered (D1.3 re-attempt policy)');
  const denied = deniedRecords[0];
  assert.equal(denied.refusal, 'application_unauthorized', 'the typed refusal code is recorded');
  assert.equal(denied.optionId, 'opt-a', 'the attempted option is preserved (D1.3 optionId?)');
  assert.equal(typeof denied.requestId, 'string', 'the record names the requestId');
  const answeredSameRequest = receipt.steering.filter((entry) => entry.trigger === 'answerDecisions' && entry.requestId === denied.requestId && entry.outcome === 'answered');
  assert.equal(answeredSameRequest.length, 0, 'no later answered record for the same requestId (D1.3)');
  // The permanence mechanism (fold §2.1, structural): the pre-answer `s.answeredKeys.add(key)`
  // must be GONE from the driveLane body — a denied key stays NOT-handled so the ask stays
  // pending. Within the body, any add must come AFTER the `answerDecision` attempt, never before.
  // At HEAD the add (:698) precedes the call (:700) → the assertion FAILS → RED.
  const laneBody = driveLaneBody();
  const preAdd = laneBody.indexOf('s.answeredKeys.add(key)');
  const answerCall = laneBody.indexOf('await answerDecision(');
  if (preAdd !== -1) {
    assert.ok(answerCall !== -1 && preAdd > answerCall,
      'the answeredKeys add must not precede the answer attempt — a denied key stays NOT-handled (D1.3 pt 2)');
  }
});

test('A3b red: a RACED answer delivery is recorded as outcome \'answered\' — the throw is swallowed (steering-trail-falsified)', async (t) => {
  // D1.3 raced leg: when handle.answer surfaces a typed throw (the delivery raced a
  // terminal member / the adapter refused), the trail must record the truth
  // `{outcome: 'denied', refusal: <code>}`. At HEAD the `try { await handle.answer(...) }
  // catch {}` swallows the code and records `outcome: 'answered'` — this row is RED at
  // the same `steering-trail-falsified` stage.
  const refusalCode = 'application_run_stopped';
  const fx = await fixture(t, {
    adapter: new RefusingAnswerAdapter({
      refusalCode,
      harness: 'mock',
      scenariosByMarker: { coordinator: decisionScenario('coordinator', { carryAttemptMarker: true }) },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a3b-raced',
    members: [member('coordinator')],
    steering: { answerDecisions: { policy: { 'Which path?': 'opt-a' } } },
    harvest: { paths: [] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.ok(fx.adapter.thrown.length >= 1, 'the answer delivery threw');
  // The truthful single-denied trail shape (fold §1.2c): exactly ONE denied record for the raced
  // requestId. At HEAD the throw is swallowed and the record is `{outcome: 'answered'}` → the
  // denied count is 0 → the assertion FAILS → RED.
  const racedRecords = receipt.steering.filter((entry) => entry.trigger === 'answerDecisions' && entry.outcome === 'denied');
  assert.equal(racedRecords.length, 1, 'exactly one denied record — a raced ask is never re-auto-answered (D1.3 re-attempt policy)');
  const raced = racedRecords[0];
  assert.equal(raced.refusal, refusalCode, 'the surfaced refusal code is recorded');
  assert.equal(typeof raced.requestId, 'string', 'the record names the requestId');
  const answeredSameRequest = receipt.steering.filter((entry) => entry.trigger === 'answerDecisions' && entry.requestId === raced.requestId && entry.outcome === 'answered');
  assert.equal(answeredSameRequest.length, 0, 'no later answered record for the same requestId (D1.3)');
});

test('A5 red: a worker-seat principal reaching a waves.* authority verb draws NO coordinator_authority_forbidden (coordinator-authority-forbidden-missing)', async (t) => {
  // D2/A5: a coordinator-seat principal (a wave member run\'s own identity) reaching a
  // wave/steering authority verb must draw `coordinator_authority_forbidden` with
  // `{attempted, gracefulPath}`. The top orchestrator\'s own authority actions never
  // fire the new code. At HEAD no such code exists — the direct waves.start port
  // (application.mjs:12506) dispatches before any authority check and the default
  // authorize is permissive, so the worker-seat principal\'s waves.start SUCCEEDS.
  // The assertion fails → RED at `coordinator-authority-forbidden-missing`.
  // GREEN leg: the top orchestrator CAN start a wave (the boundary narrows only the
  // worker seat).
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'row-1': { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/row-1.md', content: 'row-1 report\n' }] },
      },
    }),
  });
  const started = await fx.application.command('waves.start', {
    idempotencyKey: 's74-a5-owner',
    members: [{ role: 'row-1', objective: 'write row-1\n(marker:row-1)\n', exact: { ...ROUTE }, scope: ['reports/**'] }],
  }, principalOf('s74-owner'));
  assert.ok(started?.waveId?.startsWith('wave:'), 'top orchestrator can start a wave');
  // GREEN — a SECOND top-orchestrator principal (the fixture\'s `s74-observer`) can also start a
  // wave: the boundary narrows the WORKER seat, never a hardcoded allowlist of fixture principals
  // (blue-team §1.3 minor — pins seat-CLASS, not identity).
  const observerStarted = await fx.application.command('waves.start', {
    idempotencyKey: 's74-a5-observer',
    members: [{ role: 'row-1', objective: 'write row-1\n(marker:row-1)\n', exact: { ...ROUTE }, scope: ['reports/**'] }],
  }, principalOf('s74-observer'));
  assert.ok(observerStarted?.waveId?.startsWith('wave:'), 'a second top-orchestrator principal can start a wave (seat class, not identity)');
  // RED: the worker-seat principal\'s waves.start must draw coordinator_authority_forbidden.
  const workerSeat = Object.freeze({ actor: 'baton:worker:w-1', principalId: 'worker:w-1', sessionId: 'session-worker-w-1' });
  await assert.rejects(
    fx.application.command('waves.start', {
      idempotencyKey: 's74-a5-worker',
      members: [{ role: 'row-1', objective: 'write row-1\n(marker:row-1)\n', exact: { ...ROUTE }, scope: ['reports/**'] }],
    }, workerSeat),
    (error) => error?.code === 'coordinator_authority_forbidden'
      && error?.detail?.attempted === 'waves.start'
      && typeof error?.detail?.gracefulPath === 'string' && error.detail.gracefulPath.length > 0,
    'a worker-seat principal reaching waves.start must draw coordinator_authority_forbidden with {attempted, gracefulPath} (D2)',
  );
});

test('A6 red: waves.list hides the coordinator\'s route — the seat map is absent from the registry view (seat-route-hidden)', async (t) => {
  // D3/A6: the wave roster (application.mjs:11617-11621) and `waves.list` must expose
  // the coordinator\'s route so the top orchestrator sees exactly which member is the
  // heavyweight coordinator. GREEN leg: a member route OUTSIDE the deployment profile
  // refuses `wave_member_invalid` with the inner `application_route_not_allowed`
  // preserved (each member rides the same exact-route profile admission). RED leg: after
  // a `waves.run` wave (the interpreter seam — createWave mints a role-only string
  // roster, wave.mjs:157), the `waves.list` roster carries `route: null` for every
  // member — the coordinator\'s heavyweight seat is HIDDEN. The assertion fails → RED
  // at `seat-route-hidden`.
  // GREEN — the exact-route admission refuses out-of-profile routes, inner code preserved.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
        'row-1': { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/row-1.md', content: 'row-1 report\n' }] },
      },
    }),
  });
  await assert.rejects(
    fx.application.command('waves.start', {
      idempotencyKey: 's74-a6-route',
      members: [{ role: 'bad', objective: 'bad\n(marker:bad)\n', exact: { harness: 'mock', model: 'unknown-model', effort: 'low' }, scope: ['reports/**'] }],
    }, principalOf('s74-owner')),
    (error) => error?.code === 'wave_member_invalid'
      && error?.detail?.cause?.code === 'application_route_not_allowed'
      && error?.detail?.role === 'bad',
    'a route outside the deployment profile refuses wave_member_invalid with the inner application_route_not_allowed preserved',
  );
  // Drive the coordinator + swarm wave through the interpreter seam.
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  writeObjective(fx.repo, 'row-1', 'write the row-1 report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a6-seat',
    members: [
      member('coordinator', { exact: { ...HEAVY_ROUTE } }),
      member('row-1'),
    ],
    steering: {},
    harvest: { paths: [] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.equal(receipt.verdict, 'WAVE-OK', 'both seats settle');
  const wl = await fx.application.command('waves.list', {}, principalOf('s74-owner'));
  const coordinatorRow = wl.waves?.find((wave) => wave.waveId === receipt.waveId)
    ?.roster?.find((entry) => entry.role === 'coordinator');
  assert.ok(coordinatorRow, 'the coordinator row is in the waves.list roster');
  // RED — the coordinator\'s route must be exposed. At HEAD the registry view renders
  // route:null (role-only roster) → the assertion FAILS → RED.
  assert.deepEqual(coordinatorRow.route, HEAVY_ROUTE, 'waves.list exposes the coordinator\'s heavyweight route (D3)');
});

test('A8 red: the verbatim v1.1 example spec does NOT drive through waves.run — the steering policy kinds refuse (composition-example-refused)', async (t) => {
  // D4/A8: the whole pattern is declarable as the v1.1 example spec and runs through
  // `waves.run`. At HEAD the example\'s `messageOnSpawn.kind:'brief'` and
  // `signalOnMembersDone.message.kind:'result'` are NOT in the interpreter\'s closed
  // kind set `['inform','query','steer']` (workflow-interpreter.mjs:44) — the spec
  // REFUSES `workflow_steering_unknown` before any wave starts. The assertion that the
  // example drives fails → RED at `composition-example-refused`.
  // The scenarios carry delayMs so the members stay LIVE across the steering polls: the
  // coordinator (~120 ms) settles before the swarm rows (~240 ms), so `messageOnSpawn` finds
  // every member running and `signalOnMembersDone` fires while the rows are still live to receive
  // the result — the DELIVERY legs (§1.5) are reachable, not swallowed by instant completion.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'docs/results/coordinator.md', content: 'coordinator result WAVE-OK\n', delayMs: 120 }] },
        'row-1': { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'docs/results/row-1.md', content: 'row-1 done\n', delayMs: 240 }] },
        'row-2': { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'docs/results/row-2.md', content: 'row-2 done\n', delayMs: 240 }] },
      },
    }),
  });
  writeFileSync(join(fx.repo, 'sub-orchestrator-brief.md'), 'decompose the big brief\n(marker:coordinator)\n');
  writeRowBrief(fx.repo, 'row-1', 'write row-1');
  writeRowBrief(fx.repo, 'row-2', 'write row-2');
  // The D4 example spec VERBATIM (contract-fold.md §D4): message kinds 'brief' / 'result',
  // objectiveRef-only members, FILE harvest path.
  const exampleSpec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a8-verbatim',
    members: [
      { role: 'coordinator', exact: { harness: 'mock', model: 'mock-model-heavy', effort: 'high' }, scope: ['docs/results/**'], objectiveRef: 'sub-orchestrator-brief.md', report: 'docs/results/coordinator.md' },
      { role: 'row-1', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['docs/results/**'], objectiveRef: 'rows/row-1.md', report: 'docs/results/row-1.md' },
      { role: 'row-2', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['docs/results/**'], objectiveRef: 'rows/row-2.md', report: 'docs/results/row-2.md' },
    ],
    steering: {
      messageOnSpawn: { kind: 'brief', body: 'the coordinator brief' },
      answerDecisions: { policy: { 'decomposition approved': 'approve', 'scope change': 'defer' } },
      signalOnMembersDone: { roles: ['coordinator'], message: { kind: 'result', body: 'swarm rows settled' } },
      approveOnAdvertisedPlan: true,
    },
    harvest: { paths: [{ path: 'docs/results/coordinator.md', mustContain: 'WAVE-OK' }] },
  };
  // The assertion that drives the RED: the verbatim example must drive through
  // `waves.run` to a D6 receipt. At HEAD it throws `workflow_steering_unknown` (kind
  // 'brief' not in the closed inform|query|steer set) → the assertion FAILS → RED.
  const driven = await fx.application.command('waves.run', { spec: exampleSpec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.deepEqual(
    Object.keys(driven).sort(),
    ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'],
    'the verbatim example settles to the D6 receipt',
  );
  assert.equal(driven.verdict, 'WAVE-OK', 'the coordinator + swarm pattern settles honestly');
  // DELIVERY — fold §1.5: the message kinds must be accepted END-TO-END at the coordinator
  // boundary (coordinator.mjs:6864), not just by the interpreter's admission set. A widening that
  // admits `brief`/`result` but silently drops them at delivery is NOT the composition — the
  // messageOnSpawn steering entry must carry a DELIVERED messageId, and signalOnMembersDone must
  // name the swarm recipients.
  const spawned = driven.steering.filter((entry) => entry.trigger === 'messageOnSpawn');
  assert.ok(spawned.length >= 3, 'every member received a messageOnSpawn entry (coordinator + 2 rows)');
  const coordinatorBrief = spawned.find((entry) => entry.role === 'coordinator');
  assert.ok(coordinatorBrief, 'the coordinator received the brief');
  assert.match(coordinatorBrief.messageId, /^message:[a-f0-9]{64}$/u, 'the brief receipted a durable messageId');
  assert.ok(Number.isFinite(coordinatorBrief.delivered) && coordinatorBrief.delivered > 0, 'the brief was DELIVERED (delivered > 0)');
  // F3-style: the adapter actually received the coordinator\'s `[MESSAGE brief … — UNTRUSTED]`
  // delivery frame carrying the receipted messageId — a self-authored receipt without the wire
  // send fails.
  const briefFrame = fx.adapter.calls.prompt.find((call) =>
    typeof call.message === 'string' && call.message.includes(coordinatorBrief.messageId) && call.message.includes('[MESSAGE '));
  assert.ok(briefFrame, 'the coordinator boundary delivered the [MESSAGE brief frame to the member (F3)');
  // The result signal: `signalOnMembersDone.roles: ['coordinator']` → recipients are the
  // non-signal members — the swarm rows.
  const signaled = driven.steering.find((entry) => entry.trigger === 'signalOnMembersDone');
  assert.ok(signaled, 'a signalOnMembersDone steering entry exists');
  assert.ok(Array.isArray(signaled.doneRoles) && signaled.doneRoles.includes('coordinator'), 'the signal names the completed coordinator');
  assert.ok(Array.isArray(signaled.recipients) && signaled.recipients.includes('row-1') && signaled.recipients.includes('row-2'),
    'the result was signaled to the swarm rows (the recipients)');
  const resultFrame = fx.adapter.calls.prompt.find((call) =>
    typeof call.message === 'string' && call.message.includes('swarm rows settled') && call.message.includes('[MESSAGE '));
  assert.ok(resultFrame, 'the coordinator boundary delivered the [MESSAGE result signal to the rows (F3)');
});

test('A8-dir red: a DIRECTORY harvest path WITHOUT mustContain harvests ok — the file-not-directory law is not structurally enforced (file-not-directory-law-missing)', async (t) => {
  // D4 §4.3 (fold): `git show <sha>:<dir>` RETURNS the tree listing and exits 0 — it does NOT
  // fail (the v1.1 mechanism was wrong). So a directory path refuses today ONLY when its
  // `mustContain` mismatches the listing; a directory path WITHOUT mustContain recovers the
  // listing → `ok:true` → the wave can go WAVE-OK. The "file, never a directory" law must be
  // enforced STRUCTURALLY — an admission/refusal-time check that each harvest path is a regular
  // file, refusing `harvest_miss` for directories regardless of mustContain. At HEAD that
  // structural check does not exist: the directory harvest below returns WAVE-OK → the
  // assertion FAILS → RED at `file-not-directory-law-missing`.
  const fx = await fixture(t, {
    adapter: new CarryAdapter({
      harness: 'mock',
      scenariosByMarker: {
        coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'coordinator', 'write the coordinator report');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 's74-a8-dir-red',
    members: [member('coordinator')],
    steering: {},
    // A directory path with NO mustContain — the enforcement gap §4.3(b) names.
    harvest: { paths: [{ path: 'reports' }] },
  };
  const receipt = await fx.application.command('waves.run', { spec, driver: LANE_DRIVER }, principalOf('s74-owner'));
  assert.notEqual(receipt.verdict, 'WAVE-OK',
    'a directory harvest path without mustContain must NOT settle the wave — the file-not-directory law is structural (D4 §4.3)');
  assert.equal(receipt.verdict, 'WAVE-INCOMPLETE', 'the wave refuses honestly');
  assert.ok(receipt.harvest.every((entry) => entry.missed === true && entry.code === 'harvest_miss'),
    'the directory entry is a typed harvest_miss');
});
