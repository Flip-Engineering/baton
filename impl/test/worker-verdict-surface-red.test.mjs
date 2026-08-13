// Worker-verdict-surface red suite (folded #61 contract — docs/reference/evidence/
// worker-verdict-surface-2026-08-12/contract-fold.md v1.1). Red-first: every capability row is RED
// at HEAD (the surface is absent from this tree) and fails at a NAMED stage; the PIN rows are green
// today by construction and must STAY green on the implementation (the fold's "must NOT change" —
// the sanitized evidence projection, the closed gate/verifier enums, the recovery-digest pin).
//
// Row inventory (24 rows — 19 RED / 5 PIN):
//   A1-A4  RED    R1 + fold B2/B3 + fold Minor 1   (verdict-surface-missing ×4 — the four-field
//                  projection, the exact key `detail`, the closed check domain, the
//                  required_effect digest/count subset, the sanitized red_green tail)
//   B1     RED    D1 B3 null row                   (verdict-surface-missing — verification_mutation_failed
//                  carries check = the closed diagnosticCode and corrective: null)
//   B2-B3  RED    R3 + OQ1                         (corrective-table-missing — the frozen hub-minted table
//                  keyed by terminal CODE + the reachable-codes honest-absence scan)
//   B4     RED    refusal vocabulary               (forced-corrective-refusal-missing — the
//                  verdict_surface_corrective_forced literal in application.mjs)
//   C1-C2  RED    R4                               (verdict-surface-missing — replay purity with .at(-1)
//                  supersession + cross-worker isolation)
//   C3     RED    R4-b run.debug failure leg       (run-debug-verdict-missing — the shared projection
//                  rides the debug consumer: check + corrective on the failure)
//   C4     PIN    R5                               (digest-pin green + provider-brief purity — task.brief
//                  stays byte-stable under the delivery seam)
//   D1     RED    R6 boundary-commits              (live-composition-missing — the no-commit boilerplate
//                  is suppressed by the refuting #141 norm, the boundary line ships)
//   D2     RED    R6-schema                        (worktree-harvest-policy-missing — the applicationProfile
//                  field, fold B5)
//   D3     RED    R6 orchestrator-harvest          (live-composition-missing — the no-commit line ships
//                  under its named source; a TRUE line is never suppressed)
//   D4-D5  RED    R7 honesty                       (live-composition-missing → underrived-refusal-missing /
//                  unenforced-refusal-missing — underrived/unenforced lines refuse, never print)
//   D6     RED    R8 wire_frame lane-conditional   (live-composition-missing — the wire_frame HARD
//                  CONSTRAINT ships IFF the size census over the served scope shows a >~1500-line file)
//   D7     RED    R9 pure function + epoch         (live-composition-missing / epoch-missing — two
//                  composes derive the same block; the suppression record carries the epoch)
//   D8     RED    fold Minor 2                     (live-composition-missing — [attempt:] is a per-attempt
//                  discriminator, never a constraint line)
//   E1     PIN    R2 current shape                 ({digests, counts} — never a path string crosses)
//   E2     PIN    GT1                              (DEBUG_GATE_CODES closed gate enum, ACTUAL order)
//   E3     PIN    D1 B3                            (CLOSED_VERIFIER_DIAGNOSTICS closed verifier enum, ACTUAL order)
//   E4     PIN    refusal precedents               (#73 closed caller schema + R5 recovery-digest pin)
//
// Invented surfaces (every one absent at HEAD — the first assertion on each is a `typeof`/`ok`
// guard so the row fails at the NAMED stage, never on a vacuous shape assertion):
//   applicationNs.projectVerdictSurface(events)  → {gate, code, check, detail, corrective} | null
//       — the R1 four-field projection over a worker-scoped event stream (R4: pure, replay-derived,
//         .at(-1) supersession). `check` is the closed domain (whitelisted trustPhase or the closed
//         verifier diagnosticCode; everything else escalates to null); `corrective` is hub-minted by
//         terminal CODE; `detail` is the sanitized evidence class — never path strings.
//   applicationNs.VERDICT_CORRECTIVE_TABLE       — frozen, closed, keyed by terminal CODE (R3)
//   recipesNs.composeObjectiveConstraintLines(input) → {lines, suppression}
//       — the R7 live composition over the admission-time deployment state (Rule 1 named sources),
//         with the fold B6 suppression record
//         {epoch: {profileDigest, admissionSha}, suppressed: [{line, reason}]}
//   worktreeHarvestPolicy                        — the fold B5 applicationProfile field
//       ('orchestrator-harvest' default | 'boundary-commits')
//
// Suite-law hygiene: hermetic (a Coordinator-direct ScriptableAdapter for the store-seam rows + a
// real createDriver stack for the run.debug rows — no harness, no network, no real provider spawns;
// mkdtemp repos/logs; global test.after cleanup); the deployment-verification stub is the brief's
// `true` command; sorted-key literals in ACTUAL source order; `localeCompare` banned; no clocks as
// controls (a fixed microtask drain drives the real coordinator event path; the full-application
// rows inject gate events and read the debug projection synchronously — no polling, no wall-clock
// assertion); NUL discipline — application.mjs and coordination-store.mjs carry NUL bytes and are
// touched ONLY via grep -an / sed -n, never a whole-file read; the clean files (coordinator.mjs,
// application-deployment.mjs, limits.mjs) are read whole for the enum/pin slices. Verified split is
// recorded below after two consecutive runs from the repo root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BatonApplication } from '../src/application.mjs';
import * as applicationNs from '../src/application.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import * as recipesNs from '../src/recipes.mjs';

// ---------------------------------------------------------------------------
// Verified split (recorded after two consecutive runs from the repo root)
// ---------------------------------------------------------------------------
//   run 1: tests 24 · pass 5 · fail 19 · cancelled 0 · skipped 0 · todo 0 (≈3.0 s)
//   run 2: tests 24 · pass 5 · fail 19 · cancelled 0 · skipped 0 · todo 0 (≈2.6 s)
//   deterministic — the 5 passes are exactly the PIN rows (C4, E1, E2, E3, E4); the 19 failures
//   are the RED rows, each confirmed to fail at its NAMED stage.

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-61-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// NUL-discipline source pins
// ---------------------------------------------------------------------------

const APP_SRC = fileURLToPath(new URL('../src/application.mjs', import.meta.url));
const STORE_SRC = fileURLToPath(new URL('../src/coordination-store.mjs', import.meta.url));

// application.mjs and coordination-store.mjs carry NUL bytes — touched ONLY via grep -an / sed -n.
function grepAn(pattern, path) {
  try {
    return execFileSync('grep', ['-an', pattern, path], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function sedLines(path, first, last) {
  try {
    return execFileSync('sed', ['-n', `${first},${last}p`, path], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

// Extract the single-quoted snake_case literals of a bracketed enum block under a marker, in ACTUAL
// source order — bracket-sliced so a following function body's literals never leak into the set.
function enumLiteralsUnder(path, marker, windowLines = 6) {
  const hit = grepAn(marker, path);
  if (!hit) return null;
  const lineNo = Number(hit.split(':')[0]);
  if (!Number.isInteger(lineNo)) return null;
  const body = sedLines(path, lineNo, lineNo + windowLines);
  const open = body.indexOf('[');
  const close = body.indexOf(']', open);
  if (open === -1 || close === -1) return null;
  return [...body.slice(open, close).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Contract-pinned literals (ACTUAL source order; no localeCompare anywhere)
// ---------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/u;

// The sanitized evidence digests (hex64, NEVER path strings — R2/fold B2).
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const DIGEST_E = 'e'.repeat(64);
const DIGEST_F = 'f'.repeat(64);

// The R3 hub-minted corrective table (keyed by terminal CODE — #73 law) + the null rows.
const CORRECTIVE_TABLE_EXPECTED = Object.freeze({
  worker_path_scope_violation: 'in_scope_revision',
  forbidden_effect_observed: 'forbidden_effect_retraction',
  required_effect_absent: 'in_scope_edit',
  verification_red_green_failed: 'failing_check_fix',
  verification_coverage_failed: 'coverage_completion',
});
// The terminal codes REACHABLE on the surface (OQ1): the 5 corrective rows + the 8 reachable
// verifier diagnostics that carry corrective: null. A code absent from the closed table escalates.
const REACHABLE_TERMINAL_CODES = Object.freeze([
  'worker_path_scope_violation', 'forbidden_effect_observed', 'required_effect_absent',
  'verification_red_green_failed', 'verification_coverage_failed',
  'verification_output_exceeded', 'verification_timed_out', 'verification_spawn_unavailable',
  'verification_claim_diverged', 'verification_mutation_failed', 'verification_coverage_unavailable',
  'verification_mutation_unavailable', 'verification_exit_mismatch',
]);

// The D2 named-source patterns a served constraint line must match (R7 Rule 1 re-derivability).
const NAMED_SOURCE_PATTERNS = [
  /^Baton deployment profile /u,
  /^Baton workflow /u,
  /^Baton objective\/result policy /u,
  /Do not claim completion without the deployment verification command/u,
  /^Work only within: /u,
  /HARD CONSTRAINT \(wire_frame_oversize/u,
  /commit at natural subsystem boundaries/u,
  /^Do NOT git commit/u,
  /SCRATCHPAD_WRITE/u,
];

// ---------------------------------------------------------------------------
// Invented-surface event fixtures (the durable log events the projection consumes)
// ---------------------------------------------------------------------------

function baseEvent(worker, seq) {
  return { worker, harness: 'mock@1.0.0', turnEpoch: 1, seq, actor: 'worker', kind: 'error' };
}

// A real trust-gate scope refusal (the coordinator.mjs:13510-13517 mint shape).
function scopeRefusalEvent({ worker = 'w-1', seq = 7 } = {}) {
  return {
    ...baseEvent(worker, seq),
    payload: {
      message: 'captured worker result changed paths outside approved Plan scope',
      code: 'worker_path_scope_violation',
      phase: 'trust_gate',
      trustPhase: 'path_scope',
      pathScopeEvidence: {
        changedPathCount: 3,
        changedPathsDigest: DIGEST_A,
        inScopeChangedPathCount: 1,
        inScopeChangedPathsDigest: DIGEST_B,
        outOfScopeChangedPathCount: 2,
        outOfScopeChangedPathsDigest: DIGEST_C,
      },
    },
  };
}

// A real trust-gate required-effect refusal (coordinator.mjs:13229-13235 mint shape).
function requiredEffectAbsentEvent({ worker = 'w-1', seq = 6 } = {}) {
  return {
    ...baseEvent(worker, seq),
    payload: {
      message: 'required effect absent from captured result',
      code: 'required_effect_absent',
      phase: 'trust_gate',
      trustPhase: 'required_effect',
      requiredEffectEvidence: {
        changedPathCount: 4,
        changedPathsDigest: DIGEST_D,
        inScopeChangedPathCount: 0,
        inScopeChangedPathsDigest: DIGEST_E,
        outOfScopeChangedPathCount: 4,
        outOfScopeChangedPathsDigest: DIGEST_F,
      },
    },
  };
}

// A verifier refusal (kind verify.reverified, accept:false — the second debugGateRefusal candidate
// class). `check` must be the closed diagnosticCode; the capsule text is sanitizer input.
function verifierRefusalEvent(code, { worker = 'w-1', seq = 9, capsuleText = 'diagnostic detail' } = {}) {
  return {
    worker, harness: 'mock@1.0.0', turnEpoch: 1, seq, actor: 'policy', kind: 'verify.reverified',
    payload: { accept: false, verdict: { diagnosticCode: code, failureCapsule: { text: capsuleText } } },
  };
}

// A promotion-phase trust-gate failure — a raw gate-internal phase name that must escalate to
// check: null (fold B3 — only whitelisted trustPhases + closed verifier codes name WHAT was checked).
function promotionPhaseEvent({ worker = 'w-1', seq = 11 } = {}) {
  return {
    ...baseEvent(worker, seq),
    payload: { message: 'promotion refused', code: 'trust_gate_failed', phase: 'trust_gate', trustPhase: 'promotion' },
  };
}

// ---------------------------------------------------------------------------
// Harness — Coordinator-direct (mirrors worker-delivery-push-red.test.mjs)
// ---------------------------------------------------------------------------

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

// A 'claim' card (no `turnCompletion`) — the completed-turn branch falls STRAIGHT through to the
// real trust gate (TG1), which is what the R5 row needs.
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
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

function setup({ adapter, capture = noDiff, dir = null, coordinatorOpts = {} }) {
  const dirPath = dir ?? tmpDir();
  const log = new Log(join(dirPath, 'log'));
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
  return { dir: dirPath, log, coordinator, worktrees };
}

// A fixed microtask drain — the real coordinator event path is synchronous until it awaits; this
// drives exactly the production dispatch. No wall-clock behavior is asserted anywhere.
async function flush(times = 80) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

async function spawn(coordinator, overrides = {}) {
  const handle = await coordinator.spawn('mock', makeBrief(overrides));
  return { handle, task: coordinator._tasks.get(handle.taskId) };
}

function stageCompletedTurn(adapter, handle, files) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: {
      status: 'completed', progress: 1, summary: 'mock run completed',
      artifacts: { commits: [], files },
      verification: { command: 'true', claimedExit: 0 },
      budgetUsed: { tokens: 1, usd: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// Harness — full application (real createDriver + BatonApplication + bindBaton),
// run.debug rows (mirrors feedback-forge-hardening-red.test.mjs dg1Harness)
// ---------------------------------------------------------------------------

const repoId = 'repo-worker-verdict-surface';

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-61-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

class DebugAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'worker-verdict-surface-red', refreshedAt: null,
      },
    };
  }

  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function dg1Harness(t, scenario = {
  outcome: 'completed', edits: [{ path: 'reports/worker.md', content: 'work\n' }],
}) {
  const repo = root('repo');
  const logDir = root('log');
  const adapter = new DebugAdapter({ harness: 'mock', scenario });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    // watchdog.stallMs is a VALID POSITIVE integer — the watchdog's liveness window, never 0.
    watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 65_536, maxPlanBytes: 262_144, maxStatusBytes: 262_144,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000,
          maxOutputBytes: 65_536, requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter };
}

async function startRun(baton) {
  const run = await baton.runs.start('worker verdict surface fixture (marker:wvs)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : [])
    .find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';
  return { run, workerId, runId: run.id ?? status?.runId ?? view?.runId };
}

function emitScopeGateEvent(adapter, workerId) {
  adapter.emit({
    worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'error', actor: 'worker',
    payload: {
      message: 'scope',
      code: 'worker_path_scope_violation',
      phase: 'trust_gate',
      trustPhase: 'path_scope',
      pathScopeEvidence: {
        changedPathCount: 1,
        changedPathsDigest: DIGEST_A,
        inScopeChangedPathCount: 0,
        inScopeChangedPathsDigest: DIGEST_B,
        outOfScopeChangedPathCount: 1,
        outOfScopeChangedPathsDigest: DIGEST_C,
      },
    },
  });
}

// ===========================================================================
// Section A — R1 the four-field projection (shape + closed check domain)
// ===========================================================================

test('A1 (RED): a scope refusal projects the four-field surface with the exact key `detail` (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing — projectVerdictSurface(events) is the invented four-field projection');
  const surface = applicationNs.projectVerdictSurface([scopeRefusalEvent()]);
  assert.ok(surface, 'a scope refusal projects a surface record');
  assert.equal(surface.gate, 'scope', 'WHICH gate — debugGateFromLiveCode maps the scope violation');
  assert.equal(surface.code, 'worker_path_scope_violation', 'the durable terminal code rides the record');
  assert.equal(surface.check, 'path_scope', 'WHAT was checked — the whitelisted trustPhase');
  assert.deepEqual(surface.detail, {
    digests: {
      changedPathsDigest: DIGEST_A,
      inScopeChangedPathsDigest: DIGEST_B,
      outOfScopeChangedPathsDigest: DIGEST_C,
    },
    counts: { changedPathCount: 3, inScopeChangedPathCount: 1, outOfScopeChangedPathCount: 2 },
  }, 'detail is the {digests, counts} evidence class — never path strings (R2)');
  assert.equal(surface.corrective, 'in_scope_revision', 'the corrective class is hub-minted, keyed by the terminal code (R3)');
  assert.ok('detail' in surface, 'the exact key is `detail` — a #79-shape reader and an R1 reader read the same key (fold B2)');
  assert.equal('evidence' in surface, false, 'the field is never named `evidence` (fold B2)');
});

test('A2 (RED): a non-whitelisted trustPhase (promotion) escalates with check:null — a raw gate-internal phase name never crosses (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const surface = applicationNs.projectVerdictSurface([promotionPhaseEvent()]);
  assert.ok(surface, 'an error-kind refusal projects a record');
  assert.equal(surface.gate, 'unknown', 'the code maps to the honest unknown gate (application.mjs:949-956)');
  assert.equal(surface.code, 'trust_gate_failed', 'the durable terminal code is preserved');
  assert.equal(surface.check, null, 'check escalates to null — never the raw `promotion` phase name (fold B3)');
  assert.deepEqual(surface.detail, {}, 'no evidence class for the unknown gate');
  assert.equal(surface.corrective, null, 'a code absent from the corrective table carries null (escalate)');
});

test('A3 (RED): required_effect_absent projects the digest/count subset — the gate degrades to unknown, the code and corrective survive (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const surface = applicationNs.projectVerdictSurface([requiredEffectAbsentEvent()]);
  assert.ok(surface, 'a required-effect refusal projects a record');
  assert.equal(surface.gate, 'unknown', 'today’s mapping degrades required_effect_absent to gate unknown (application.mjs:949-956)');
  assert.equal(surface.code, 'required_effect_absent', 'the durable terminal code is preserved (application.mjs:937-943)');
  assert.equal(surface.check, 'required_effect', 'WHAT was checked — the whitelisted trustPhase');
  assert.deepEqual(surface.detail, {
    changedPathCount: 4, changedPathsDigest: DIGEST_D,
    inScopeChangedPathCount: 0, inScopeChangedPathsDigest: DIGEST_E,
  }, 'detail is the digest/count subset of requiredEffectEvidence — never paths (fold Minor 1)');
  assert.equal(surface.corrective, 'in_scope_edit', 'the corrective is keyed by the terminal CODE, so it survives the gate degradation (R3)');
});

test('A4 (RED): a red_green verifier refusal projects check = the closed diagnosticCode and a sanitized tail — an adversarial capsule never crosses (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const secret = 'trace at /Users/alice/projects/secret/lib.rs:12 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue';
  const surface = applicationNs.projectVerdictSurface([
    verifierRefusalEvent('verification_red_green_failed', { capsuleText: secret }),
  ]);
  assert.ok(surface, 'a verifier refusal projects a record');
  assert.equal(surface.gate, 'red_green', 'WHICH gate — debugGateFromLiveCode maps the red_green diagnostic');
  assert.equal(surface.code, 'verification_red_green_failed', 'the terminal code rides the record');
  assert.equal(surface.check, 'verification_red_green_failed', 'check is the closed diagnosticCode itself — never a two-row label (fold B3)');
  assert.equal(typeof surface.detail?.tail, 'string', 'detail.tail is the sanitizer output (application.mjs:958-990)');
  assert.ok(!surface.detail.tail.includes('/Users/alice'), 'the adversarial home path never crosses');
  assert.ok(!JSON.stringify(surface.detail).includes('eyJhbGciOiJIUzI1NiJ9'), 'the adversarial JWT never crosses');
  assert.equal(surface.corrective, 'failing_check_fix', 'the corrective is keyed by the terminal code');
});

// ===========================================================================
// Section B — the closed corrective table + the refusal vocabulary
// ===========================================================================

test('B1 (RED): a reachable verifier diagnostic with no corrective carries corrective:null and the closed code as check (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const surface = applicationNs.projectVerdictSurface([verifierRefusalEvent('verification_mutation_failed')]);
  assert.ok(surface, 'a null-corrective diagnostic projects a record');
  assert.equal(surface.gate, 'unknown', 'the diagnostic is not a mapped gate');
  assert.equal(surface.check, 'verification_mutation_failed', 'the closed diagnosticCode names WHAT was checked (fold B3)');
  assert.deepEqual(surface.detail, {}, 'no evidence class for the unknown gate');
  assert.equal(surface.corrective, null, 'the eight null diagnostics escalate — honest absence, never an invented corrective (D1 B3)');
});

test('B2 (RED): VERDICT_CORRECTIVE_TABLE is the frozen hub-minted corrective table, keyed by terminal code (stage: corrective-table-missing)', () => {
  assert.ok(applicationNs.VERDICT_CORRECTIVE_TABLE, 'stage: corrective-table-missing — VERDICT_CORRECTIVE_TABLE is a module export (application.mjs)');
  assert.ok(Object.isFrozen(applicationNs.VERDICT_CORRECTIVE_TABLE), 'the table is frozen — a caller cannot rewrite a corrective (#73)');
  const table = applicationNs.VERDICT_CORRECTIVE_TABLE;
  assert.equal(table.worker_path_scope_violation, 'in_scope_revision');
  assert.equal(table.forbidden_effect_observed, 'forbidden_effect_retraction');
  assert.equal(table.required_effect_absent, 'in_scope_edit');
  assert.equal(table.verification_red_green_failed, 'failing_check_fix');
  assert.equal(table.verification_coverage_failed, 'coverage_completion');
});

test('B3 (RED): every terminal code REACHABLE on the surface has a corrective or null in the closed table (OQ1 source-scan)', () => {
  assert.ok(applicationNs.VERDICT_CORRECTIVE_TABLE, 'stage: corrective-table-missing');
  const table = applicationNs.VERDICT_CORRECTIVE_TABLE;
  for (const code of REACHABLE_TERMINAL_CODES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(table, code),
      `the reachable code ${code} has a row — a corrective or an honest null (OQ1)`,
    );
    const corrective = table[code];
    assert.ok(
      typeof corrective === 'string' || corrective === null,
      `${code} carries a corrective class or null — never an invented value`,
    );
  }
});

test('B4 (RED): the verdict_surface_corrective_forced refusal is a typed surface constant in application.mjs (stage: forced-corrective-refusal-missing)', () => {
  assert.ok(
    grepAn('verdict_surface_corrective_forced', APP_SRC).includes('verdict_surface_corrective_forced'),
    'stage: forced-corrective-refusal-missing — the refusal code literal exists in application.mjs (a caller-authored corrective is refused, never absorbed)',
  );
});

// ===========================================================================
// Section C — R4 the projection is a pure function of the worker-scoped log;
//             R5 the surface never rides the brief
// ===========================================================================

test('C1 (RED): two replays over the same log derive the same surface; the latest evidence supersedes (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const events = [scopeRefusalEvent(), verifierRefusalEvent('verification_red_green_failed')];
  const first = applicationNs.projectVerdictSurface(events);
  const second = applicationNs.projectVerdictSurface(events);
  assert.deepEqual(first, second, 'a pure function of the durable event log — replay-stable (R4)');
  assert.equal(first.gate, 'red_green', 'the surface reflects the LATEST refusal (.at(-1) supersession)');
  assert.equal(first.code, 'verification_red_green_failed', 'the terminal code is the latest evidence’s code');
});

test('C2 (RED): a worker receives ITS OWN surface — the projection is worker-scoped, never run-wide (stage: verdict-surface-missing)', () => {
  assert.equal(typeof applicationNs.projectVerdictSurface, 'function', 'stage: verdict-surface-missing');
  const aEvents = [scopeRefusalEvent({ worker: 'w-a', seq: 5 })];
  const bEvents = [requiredEffectAbsentEvent({ worker: 'w-b', seq: 6 })];
  const all = [...aEvents, ...bEvents];
  const aSurface = applicationNs.projectVerdictSurface(all.filter((event) => event.worker === 'w-a'));
  const bSurface = applicationNs.projectVerdictSurface(all.filter((event) => event.worker === 'w-b'));
  assert.equal(aSurface.check, 'path_scope', 'worker A receives ITS OWN scope refusal');
  assert.equal(bSurface.check, 'required_effect', 'worker B receives ITS OWN required-effect refusal');
  assert.equal(bSurface.corrective, 'in_scope_edit', 'worker B’s corrective is its own');
  assert.equal(applicationNs.projectVerdictSurface(all).code, 'required_effect_absent',
    'the projection respects the input set’s own ordering — never a run-wide global latest');
});

test('C3 (RED): the run.debug failure leg carries the same check/corrective — the shared projection on the DG-1 consumer (stage: run-debug-verdict-missing)', async (t) => {
  const { application, baton, adapter } = dg1Harness(t);
  const { workerId, runId } = await startRun(baton);
  emitScopeGateEvent(adapter, workerId);
  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0]?.failure;
  assert.equal(failure?.gate, 'scope', 'precondition: the failure leg projects the scope gate');
  assert.equal(failure?.check, 'path_scope', 'stage: run-debug-verdict-missing — the failure leg carries WHAT was checked');
  assert.equal(failure?.corrective, 'in_scope_revision', 'the corrective class rides the same projection');
  assert.ok('detail' in (failure ?? {}), 'the sanitized evidence key is `detail` on this consumer too (fold B2)');
});

test('C4 (PIN): the surface never rides the refinement brief — task.brief stays byte-stable when the verdict surface is present (R5)', async () => {
  const adapter = new ScriptableAdapter();
  const outOfScope = async () => ({ sha: 'sha-x', baseSha: 'sha-base', changedPaths: ['outside.txt'] });
  const { coordinator } = setup({ adapter, capture: outOfScope });
  const { handle, task } = await spawn(coordinator, { pathScope: ['reports/**'] });
  stageCompletedTurn(adapter, handle, ['outside.txt']);
  await flush();
  const gate = coordinator._log.read(handle.id)
    .find((event) => event.kind === 'error' && event.payload?.phase === 'trust_gate');
  assert.ok(gate, 'precondition: the scope violation minted the trust-gate error');
  const snapshot = structuredClone(task.brief);
  coordinator._providerBrief(task.brief, handle.id); // the delivery seam — the surface rides the push, never the brief
  assert.deepEqual(task.brief, snapshot, 'the admitted brief is byte-stable — the recovery-refinement digest pin never moves (R5)');
  assert.ok(!JSON.stringify(task.brief).includes('in_scope_revision'),
    'no corrective class ever lands in the brief (the surface rides the push, not the objective text)');
  assert.ok(
    grepAn('recovery_refinement_conflict', STORE_SRC).includes('recovery_refinement_conflict')
      && grepAn('canonicalDigest(fields.brief)', STORE_SRC).includes('canonicalDigest(fields.brief)'),
    'the recovery-refinement digest pin compares the brief canonically (coordination-store.mjs:3037)',
  );
});

// ===========================================================================
// Section D — D2 the live objective composition (worktreeHarvestPolicy + honesty)
// ===========================================================================

test('D1 (RED): a boundary-commit deployment never ships the no-commit line — the worktreeHarvestPolicy read (stage: live-composition-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing — composeObjectiveConstraintLines is the invented live composition');
  const result = recipesNs.composeObjectiveConstraintLines({
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'boundary-commits',
      constraints: ['Do not claim completion without the deployment verification command.'],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'a'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
  });
  assert.ok(Array.isArray(result.lines), 'the composition returns the served constraint block');
  assert.ok(!result.lines.some((line) => line.includes('Do NOT git commit')),
    'the no-commit boilerplate NEVER ships where worktreeHarvestPolicy is boundary-commits (R6)');
  assert.ok(result.lines.some((line) => line.includes('boundary')),
    'the live-derived boundary-commit line ships — commit at natural subsystem boundaries (#141)');
  assert.ok(result.suppression && Array.isArray(result.suppression.suppressed), 'the suppression record is present (fold B6)');
  const suppressedNoCommit = result.suppression.suppressed.find((entry) => entry.line.includes('Do NOT git commit'));
  assert.ok(suppressedNoCommit, 'the suppression record names the no-commit line');
  assert.ok(suppressedNoCommit.reason.includes('boundary-commit'),
    'the suppression reason names the refuting norm (no-commit refuted by the #141 boundary-commit norm)');
  for (const line of result.lines) {
    assert.ok(NAMED_SOURCE_PATTERNS.some((pattern) => pattern.test(line)),
      `every served line is re-derivable from a named live source (R7 Rule 1) — ${line}`);
  }
});

test('D2 (RED): the applicationProfile schema declares the worktreeHarvestPolicy field (stage: worktree-harvest-policy-missing)', () => {
  const source = readFileSync(new URL('../src/application-deployment.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function applicationProfile');
  assert.ok(start !== -1, 'precondition: applicationProfile exists');
  const profileSource = source.slice(start, start + 1200);
  assert.ok(
    profileSource.includes('worktreeHarvestPolicy'),
    'stage: worktree-harvest-policy-missing — the profile schema carries worktreeHarvestPolicy (fold B5)',
  );
  assert.match(profileSource, /orchestrator-harvest/u, 'the default value is named orchestrator-harvest (fold B5)');
});

test('D3 (RED): an orchestrator-harvest deployment ships the no-commit line under its named source (stage: live-composition-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const result = recipesNs.composeObjectiveConstraintLines({
    profile: {
      name: 'default', digest: 'q'.repeat(64), worktreeHarvestPolicy: 'orchestrator-harvest',
      constraints: ['Do not claim completion without the deployment verification command.'],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'b'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
  });
  assert.ok(result.lines.some((line) => line.includes('Do NOT git commit')),
    'on an orchestrator-harvest deployment the no-commit line is TRUE and ships (R6/Rule 2)');
  assert.ok(!result.lines.some((line) => line.includes('boundary')),
    'the #141 boundary-commit line never ships on an orchestrator-harvest deployment (OQ3)');
  assert.ok(!result.suppression.suppressed.some((entry) => entry.line.includes('Do NOT git commit')),
    'a TRUE line is never suppressed (Rule 2)');
  for (const line of result.lines) {
    assert.ok(NAMED_SOURCE_PATTERNS.some((pattern) => pattern.test(line)),
      `every served line is re-derivable from a named live source (R7 Rule 1) — ${line}`);
  }
});

test('D4 (RED): an underrived requested line refuses objective_constraint_underrived and is never printed (stage: live-composition-missing / underrived-refusal-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const input = {
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'orchestrator-harvest', constraints: [],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'a'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
    requestedLines: ['Ship this underrived line immediately.'],
  };
  const outcome = (() => {
    try { return { result: recipesNs.composeObjectiveConstraintLines(input) }; }
    catch (error) { return { refused: error.code }; }
  })();
  assert.equal(outcome.result, undefined,
    'stage: underrived-refusal-missing — an underrived line refuses, never silently prints (R7 honesty rule 2)');
  assert.equal(outcome.refused, 'objective_constraint_underrived', 'the typed refusal fires');
});

test('D5 (RED): a line naming a bound the deployment does not enforce refuses objective_constraint_unenforced (stage: live-composition-missing / unenforced-refusal-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const input = {
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'orchestrator-harvest', constraints: [],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'a'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
    requestedLines: ['HARD CONSTRAINT (phantom_bound): the deployment enforces phantom_bound.'],
  };
  const outcome = (() => {
    try { return { result: recipesNs.composeObjectiveConstraintLines(input) }; }
    catch (error) { return { refused: error.code }; }
  })();
  assert.equal(outcome.result, undefined,
    'stage: unenforced-refusal-missing — a line naming a phantom bound refuses, never prints (R7/Rule 2)');
  assert.equal(outcome.refused, 'objective_constraint_unenforced', 'the unenforced refusal fires');
});

test('D6 (RED): the wire_frame line is lane-conditional — it ships IFF the size census over the served scope shows a file over ~1500 lines (stage: live-composition-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const base = {
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'orchestrator-harvest', constraints: [],
    },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'a'.repeat(40),
  };
  const bigFileLane = recipesNs.composeObjectiveConstraintLines({
    ...base,
    goal: { pathScope: ['impl/src/**'] },
    sizeCensus: { 'impl/src/application.mjs': 13_330 },
  });
  assert.ok(bigFileLane.lines.some((line) => line.includes('wire_frame_oversize')),
    'a lane whose served scope carries a file over ~1500 lines gets the wire_frame HARD CONSTRAINT (R8, recipes.mjs:531)');
  const smallLane = recipesNs.composeObjectiveConstraintLines({
    ...base,
    goal: { pathScope: ['docs/**'] },
    sizeCensus: { 'docs/guide.md': 100 },
  });
  assert.ok(!smallLane.lines.some((line) => line.includes('wire_frame_oversize')),
    'a lane whose scope has no such file never carries the line (R8)');
});

test('D7 (RED): the composed block is a pure function of live policy, frozen at admission — two composes derive the same block and a suppression record carrying the epoch (stage: live-composition-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const input = {
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'boundary-commits',
      constraints: ['Do not claim completion without the deployment verification command.'],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: 'Baton workflow wave:seat:join',
    resultConstraint: 'Baton objective/result policy explicit change_v1',
    admissionSha: 'a'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
  };
  const first = recipesNs.composeObjectiveConstraintLines(input);
  const second = recipesNs.composeObjectiveConstraintLines(input);
  assert.deepEqual(first.lines, second.lines, 'the served block is a pure function of the admission-time deployment state (R9)');
  assert.deepEqual(first.suppression, second.suppression, 'the suppression record is a pure function too (R9)');
  assert.ok(first.suppression?.epoch, 'stage: epoch-missing — the suppression record carries the derivation epoch (fold B6)');
  assert.equal(first.suppression.epoch.profileDigest, 'p'.repeat(64), 'the epoch names the profile digest');
  assert.equal(first.suppression.epoch.admissionSha, 'a'.repeat(40), 'the epoch names the admission SHA');
});

test('D8 (RED): the [attempt:] line is a per-attempt discriminator, never a constraint line (stage: live-composition-missing)', () => {
  assert.equal(typeof recipesNs.composeObjectiveConstraintLines, 'function', 'stage: live-composition-missing');
  const result = recipesNs.composeObjectiveConstraintLines({
    profile: {
      name: 'default', digest: 'p'.repeat(64), worktreeHarvestPolicy: 'orchestrator-harvest', constraints: [],
    },
    goal: { pathScope: ['impl/test/**'] },
    workflowConstraint: null,
    resultConstraint: null,
    admissionSha: 'a'.repeat(40),
    sizeCensus: { 'impl/test/example.test.mjs': 120 },
  });
  assert.ok(!result.lines.some((line) => line.includes('[attempt:')),
    'the attempt discriminator never rides the constraint block — renderObjective appends it from the attempt salt (fold Minor 2)');
});

// ===========================================================================
// Section E — PIN rows (green today AND under the correct implementation)
// ===========================================================================

test('E1 (PIN): the run.debug scope detail is {digests, counts} in ACTUAL order and never path strings — the sanitized evidence projection holds (R2)', async (t) => {
  const { application, baton, adapter } = dg1Harness(t);
  const { workerId, runId } = await startRun(baton);
  emitScopeGateEvent(adapter, workerId);
  const debug = await application.debug({ runId }, principal('observer'));
  const detail = debug.members[0]?.failure?.detail;
  assert.ok(detail, 'the failure leg carries the projected detail');
  assert.deepEqual(Object.keys(detail), ['digests', 'counts'],
    'the scope detail shape is {digests, counts} — ACTUAL source order (application.mjs:962)');
  assert.ok(!JSON.stringify(detail).includes('outside.txt'), 'never a path string crosses the projection');
  assert.match(detail.digests.changedPathsDigest, HEX64, 'the digest is sha256 hex');
  assert.equal(typeof detail.counts.changedPathCount, 'number', 'the count is a number');
});

test('E2 (PIN): DEBUG_GATE_CODES is the closed gate enum in ACTUAL order — an added gate code kills this pin (GT1)', () => {
  assert.deepEqual(
    enumLiteralsUnder(APP_SRC, 'const DEBUG_GATE_CODES'),
    ['scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown'],
    'DEBUG_GATE_CODES is exactly {scope, red_green, coverage, route_mismatch, forbidden_effect, unknown} in ACTUAL source order (application.mjs:945-948)',
  );
});

test('E3 (PIN): CLOSED_VERIFIER_DIAGNOSTICS is the closed verifier enum in ACTUAL order (fold D1 B3)', () => {
  assert.deepEqual(
    enumLiteralsUnder(fileURLToPath(new URL('../src/coordinator.mjs', import.meta.url)), 'const CLOSED_VERIFIER_DIAGNOSTICS'),
    [
      'verification_output_exceeded', 'verification_timed_out', 'verification_spawn_unavailable',
      'verification_claim_diverged', 'verification_red_green_failed', 'verification_coverage_failed',
      'verification_mutation_failed', 'verification_coverage_unavailable', 'verification_mutation_unavailable',
      'verification_passed', 'verification_exit_mismatch',
    ],
    'the closed verifier enum in ACTUAL source order (coordinator.mjs:428-433)',
  );
});

test('E4 (PIN): the cross-referenced refusal laws stay alive — the #73 closed caller schema and the R5 recovery-digest pin (refusal vocabulary)', () => {
  assert.ok(
    grepAn('application_workflow_feedback_invalid', APP_SRC).includes('application_workflow_feedback_invalid'),
    'a caller-authored gate-shaped verdict refuses — the #73 closed {gate, detail} caller schema (application.mjs:1597)',
  );
  assert.ok(
    grepAn('recovery_refinement_conflict', STORE_SRC).includes('recovery_refinement_conflict')
      && grepAn('canonicalDigest(fields.brief)', STORE_SRC).includes('canonicalDigest(fields.brief)'),
    'the recovery-refinement digest pin is byte-stable (R5 source, coordination-store.mjs:3037)',
  );
});
