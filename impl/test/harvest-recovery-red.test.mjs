// harvest-recovery-red.test.mjs — red-first pin for issue #241: a harvest_miss row must
// carry the MEMBER OUTCOME's resultSha through as `recoverySha` (the work is not lost; the
// pinned checkpoint is the pointer). Measured (wave-h): a row completed work_completed with
// resultSha 9d3d766fa4 (the checkpoint exists and is pinned) but its declared report missed
// harvest — the settle receipt showed harvest_miss with NO pointer to the recoverable work;
// recovery required ledger archaeology.
//
// Binding contract: docs/reference/evidence/workflow-as-data-2026-08-06/
//   workflow-as-data-contract.md v1.2 — D3/D4 (harvest receipts, harvest_miss is NAMED, never
//   silent), B1 (harvest reads the run's authoritative result sha), F4 (the D4 attempt-marker
//   attribution discriminator), F9 (a miss forces WAVE-INCOMPLETE over the manifest-digest
//   basis), D6 (the seven-key receipt). Idioms: workflow-as-data-red.test.mjs (wadFixture +
//   TrackingMarkerAdapter + LANE_DRIVER) and wave-settle-error-surfacing-red.test.mjs.
//
// Rows:
//   R1  (RED at HEAD) absent-path miss + member outcome sha: the harvest_miss row surfaces
//       the member outcome's resultSha as recoverySha; the member outcome KEEPS resultSha;
//       the absent row's own resultSha stays null (nothing was recovered — honest); the
//       recovered row stays harvest_ok WITHOUT recoverySha (the pointer is miss-scoped).
//   R2  (RED at HEAD) absent-path miss + NO member sha: recoverySha is null — never invented.
//   R3  (RED at HEAD) marker-miss (:836): recovered content without the wave's attempt marker
//       receipts harvest_miss carrying recoverySha === the recovered member sha.
//   R4  (RED at HEAD) mustContain-miss (:839): recovered content lacking the mustContain
//       token receipts harvest_miss carrying recoverySha === the recovered member sha.
//
// At HEAD every row fails at the named recoverySha assertion (the field does not exist); the
// fix adds the field to exactly the miss rows. SUITE LAW: hermetic (tmp repos, mock adapter,
// in-process stack, no network); RED rows fail a plausible WRONG implementation (a fix that
// moves/renames resultSha, invents a sha, or drops the pointer fails R1-R4).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const REPO = 'repo-harvest-recovery';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-hr-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
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

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
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

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

// The lane's fast driver policy (F11): never the 20 s default poll — scenario edits land and
// the drive settles on terminality, so the timing budget is bounded and load-insensitive.
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

// ---------------------------------------------------------------------------
// Adapter machinery (workflow-as-data-red TrackingMarkerAdapter idioms, minimal).
// ---------------------------------------------------------------------------

// Marker-routed scenarios; a `carryAttemptMarker` scenario prepends the wave's real
// `[attempt: <salt> <role>] ` salt line onto every committed edit, so the D4 verification
// can attribute the recovered content (F4/B2).
class MarkerCarryingAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
  }

  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'harvest-recovery-red', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker]
      ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    if (scenario.carryAttemptMarker) {
      this._carryMarker = this._carryMarker ?? new Map();
      const salt = /^\[attempt: [^\]]+\] /u.exec(brief?.goal ?? '');
      this._carryMarker.set(worker, salt ? salt[0] : '[attempt: missing] ');
    }
    return super.spawn(worker, brief, { ...options, scenario });
  }

  async _applyEdit(session, edit) {
    const salt = this._carryMarker?.get(session.worker);
    if (salt) edit = { ...edit, content: `${salt}${edit.content}` };
    return super._applyEdit(session, edit);
  }
}

// A pausable-turn member (quiescence-completion-red idioms): the card override
// `turnCompletion: 'pausable'` completes a turn then parks instead of finalizing — the run
// never reaches terminal, never mints a result section sha or a retained pin, so
// materializeSha resolves null: the deterministic NO-member-sha branch for R2.
class PausableParkAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
  }

  card() {
    return { ...super.card(), turnCompletion: 'pausable' };
  }

  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker]
      ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    return super.spawn(worker, brief, { ...options, scenario: JSON.parse(JSON.stringify(scenario)) });
  }
}

// ---------------------------------------------------------------------------
// Fixture.
// ---------------------------------------------------------------------------

async function fixture(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const coordAdapter = adapter ?? new MarkerCarryingAdapter({
    harness: 'mock',
    scenariosByMarker: { default: { outcome: 'completed' } },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2_000,
    // Neutralize the worker watchdog: a stallMs far beyond any test window so a parked turn's
    // timer never fires and writes nothing that flaps the stall marker.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('hr-planner'),
      dispatcher: principalOf('hr-dispatcher'),
      observer: principalOf('hr-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('hr-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('hr-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter: coordAdapter };
}

function member(role) {
  return {
    role,
    exact: { ...ROUTE },
    scope: ['reports/**'],
    objectiveRef: `objectives/${role}.md`,
    report: `reports/${role}.md`,
  };
}

function writeObjective(repo, role, text) {
  writeFileSync(join(repo, 'objectives', `${role}.md`), `${text}\n(marker:${role})\n`);
}

function driveLane(baton, spec) {
  return baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER, detach: false });
}

const byPath = (receipt) => new Map((receipt.harvest ?? []).map((entry) => [entry.path, entry]));

// ===========================================================================
// R1 — the measured shape: a completed member whose checkpoint is pinned, a harvest that
// recovers the present path and MISSES the absent one. The miss row must surface the member
// outcome's resultSha as recoverySha; the member outcome keeps resultSha; the absent row's
// own resultSha stays null (nothing was recovered — honest); the recovered row stays
// harvest_ok WITHOUT recoverySha (the pointer is miss-scoped).
// ===========================================================================

test('R1-absent-path-miss-carries-recoverySha (RED at HEAD): a harvest_miss row surfaces the member outcome resultSha as recoverySha while resultSha stays on the member outcome', async (t) => {
  const fx = await fixture(t, new MarkerCarryingAdapter({
    harness: 'mock',
    scenariosByMarker: {
      'hr-a': {
        outcome: 'completed',
        carryAttemptMarker: true,
        edits: [{ path: 'reports/hr-a.md', content: 'hr-a report\n' }],
      },
    },
  }));
  writeObjective(fx.repo, 'hr-a', 'write the hr-a report, then finish');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 'hr-r1',
    members: [member('hr-a')],
    steering: {},
    harvest: { paths: ['reports/hr-a.md', 'reports/hr-a-missing.md'] },
  };
  const receipt = await driveLane(fx.baton, spec);
  const entries = byPath(receipt);
  const outcome = receipt.outcomes[0];

  // The member outcome carries the pinned checkpoint sha — the recoverable work (the measured
  // 9d3d766fa4 shape: work_completed, sha present, harvest missed).
  assert.ok(typeof outcome?.resultSha === 'string' && outcome.resultSha.length > 0,
    'R1: the member outcome carries a resultSha (the work completed and is pinned)');
  const found = entries.get('reports/hr-a.md');
  const absent = entries.get('reports/hr-a-missing.md');
  assert.ok(found?.code === 'harvest_ok', 'R1: the present path receipts harvest_ok');
  assert.ok(absent?.code === 'harvest_miss', 'R1: the absent path receipts harvest_miss');
  // #241: the miss row SURFACES the member outcome's sha as recoverySha — the pin is the
  // pointer to the recoverable work. RED at HEAD: the field does not exist.
  assert.equal(absent.recoverySha, outcome.resultSha,
    'R1 (RED at HEAD): the harvest_miss row carries recoverySha === the member outcome resultSha (issue #241)');
  // The member outcome KEEPS resultSha (the field is copied through, never moved/renamed).
  assert.equal(outcome.resultSha, absent.recoverySha,
    'R1: resultSha stays on the member outcome alongside the harvest row recoverySha');
  // The absent row's own resultSha stays null — nothing was recovered from that path, honest.
  assert.equal(absent.resultSha, null,
    'R1: the absent-path row still receipts resultSha null (nothing recovered there)');
  // The pointer is MISS-scoped: the recovered harvest_ok row never invents recoverySha.
  assert.equal(found.recoverySha, undefined,
    'R1 (guard): a harvest_ok row carries no recoverySha — the pointer names a MISS, never a found row');
  assert.equal(receipt.verdict, 'WAVE-INCOMPLETE',
    'R1: a missing harvest path makes the verdict WAVE-INCOMPLETE (F9)');
});

// ===========================================================================
// R2 — the no-sha branch: a pausable member that completes a turn then PARKS never
// finalizes — no result section sha, no retained pin, so the outcome settles resultSha
// null (the quiescence-completion R1 shape: "a quiesced member with no committed result
// sha"). The absent-path miss must receipt recoverySha null — the pointer is never
// invented.
// ===========================================================================

test('R2-absent-path-miss-no-sha (RED at HEAD): with no member resultSha the harvest_miss row receipts recoverySha null — never invented', async (t) => {
  const fx = await fixture(t, new PausableParkAdapter({
    harness: 'mock',
    scenariosByMarker: {
      'hr-b': { outcome: 'completed', summary: 'park', edits: [{ path: 'reports/hr-b.md', content: 'b\n', delayMs: 30 }] },
    },
  }));
  writeObjective(fx.repo, 'hr-b', 'write the hr-b report, then finish');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 'hr-r2',
    members: [member('hr-b')],
    steering: {},
    harvest: { paths: ['reports/hr-b.md'] },
  };
  const receipt = await driveLane(fx.baton, spec);
  const miss = byPath(receipt).get('reports/hr-b.md');
  const outcome = receipt.outcomes[0];

  assert.equal(outcome?.resultSha, null,
    'R2: the quiesced member outcome carries no resultSha (never finalized — no pin)');
  assert.ok(miss?.code === 'harvest_miss', 'R2: the absent path receipts harvest_miss');
  // RED at HEAD: recoverySha is undefined; the contract is the explicit null (never invented).
  assert.equal(miss.recoverySha, null,
    'R2 (RED at HEAD): no member resultSha → recoverySha null — the pointer is never invented (issue #241)');
  assert.equal(receipt.verdict, 'WAVE-QUIESCED',
    'R2: a parked roster receipts the named quiescence verdict');
});

// ===========================================================================
// R3 — marker-miss site (:836): recovered content WITHOUT the wave's attempt marker
// receipts harvest_miss; the miss row carries recoverySha === the recovered member sha.
// ===========================================================================

test('R3-marker-miss-carries-recoverySha (RED at HEAD): a marker-miss harvest_miss row carries recoverySha === the recovered member sha', async (t) => {
  const fx = await fixture(t, new MarkerCarryingAdapter({
    harness: 'mock',
    scenariosByMarker: {
      'hr-c': {
        outcome: 'completed',
        // carryAttemptMarker omitted: the committed report does NOT carry the wave's marker.
        edits: [{ path: 'reports/hr-c.md', content: 'hr-c report without the attempt marker\n' }],
      },
    },
  }));
  writeObjective(fx.repo, 'hr-c', 'write the hr-c report, then finish');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 'hr-r3',
    members: [member('hr-c')],
    steering: {},
    harvest: { paths: [{ path: 'reports/hr-c.md', mustContain: 'hr-c report without the attempt marker' }] },
  };
  const receipt = await driveLane(fx.baton, spec);
  const entry = byPath(receipt).get('reports/hr-c.md');
  const outcome = receipt.outcomes[0];

  assert.ok(typeof outcome?.resultSha === 'string', 'R3: the member outcome carries a resultSha');
  assert.equal(entry?.code, 'harvest_miss',
    'R3: content without the wave\'s attempt marker receipts the NAMED harvest_miss (F4)');
  assert.ok(!(entry?.bytes ?? entry?.actual ?? '').includes('[attempt: '),
    'R3: the recovered content lacks the marker — exactly why it refuses (F4)');
  assert.equal(entry?.resultSha, outcome.resultSha,
    'R3: the miss row receipts the recovered member sha as resultSha');
  assert.equal(entry?.recoverySha, outcome.resultSha,
    'R3 (RED at HEAD): the marker-miss row carries recoverySha === the member outcome resultSha (issue #241)');
});

// ===========================================================================
// R4 — mustContain-miss site (:839): content carrying the marker but lacking the
// mustContain token receipts harvest_miss; the miss row carries recoverySha.
// ===========================================================================

test('R4-mustContain-miss-carries-recoverySha (RED at HEAD): a mustContain-miss harvest_miss row carries recoverySha === the recovered member sha', async (t) => {
  const fx = await fixture(t, new MarkerCarryingAdapter({
    harness: 'mock',
    scenariosByMarker: {
      'hr-d': {
        outcome: 'completed',
        carryAttemptMarker: true,
        edits: [{ path: 'reports/hr-d.md', content: 'hr-d report with the marker\n' }],
      },
    },
  }));
  writeObjective(fx.repo, 'hr-d', 'write the hr-d report, then finish');
  const spec = {
    schemaVersion: 1,
    idempotencyKey: 'hr-r4',
    members: [member('hr-d')],
    steering: {},
    harvest: { paths: [{ path: 'reports/hr-d.md', mustContain: 'UNREACHABLE-TOKEN' }] },
  };
  const receipt = await driveLane(fx.baton, spec);
  const entry = byPath(receipt).get('reports/hr-d.md');
  const outcome = receipt.outcomes[0];

  assert.ok(typeof outcome?.resultSha === 'string', 'R4: the member outcome carries a resultSha');
  assert.equal(entry?.code, 'harvest_miss',
    'R4: the mustContain mismatch receipts the NAMED harvest_miss (B1 — post-check, never the selection mechanism)');
  assert.equal(entry?.expected, 'UNREACHABLE-TOKEN', 'R4: the receipt names the expected content');
  assert.equal(entry?.resultSha, outcome.resultSha,
    'R4: the miss row receipts the recovered member sha as resultSha');
  assert.equal(entry?.recoverySha, outcome.resultSha,
    'R4 (RED at HEAD): the mustContain-miss row carries recoverySha === the member outcome resultSha (issue #241)');
});
