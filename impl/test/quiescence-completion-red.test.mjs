// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-163]
// #163 red-first suite — folded quiescence-completion contract v2 (issue #163).
// Authority: docs/reference/evidence/contract-foundry-2026-08-13/
//   contract-163.md (v2 — folded source of truth), fold-163.md (fold notes + judgment calls),
//   redteam-163.md (B1/B2/B3 + secondaries), row-quiescence.md (this row's brief),
//   foundry-brief.md (the shared frame — the attempt-echo law #171 binds the header above).
//
// Fourteen rows over the v2 acceptance pins A1-A13 + the D2.4/D3.3 preservation guardrails:
//   R1   quiet full roster receipts WAVE-QUIESCED + basis 'quiesced' + { evidence: 'wave_quiesced' }
//        + per-member quiescenceLastMeaningfulAt / quiescenceSilenceMs / progressClass (A1/A8).
//   R2   a mid-turn member (phase 'running' — NOT the literal ACTIVE_TURN_PHASES vocabulary) +
//        quiet member NEVER quiesces; the phase-stuck member is terminalized-unrecoverable with the
//        wave_terminalized_unrecoverable evidence line (A12, totality leg b + fold judgment call 1).
//   R3   the landed readView return projects lastProgress / silenceMs / progressClass from the
//        outline (A7 / B3) — the one-command poll the predicate reads.
//   R4a  the window floor is the named evidence-count constant QUIESCENCE_MIN_SILENT_POLLS and the
//        cadence term maxObservedGapMs (A2, D1.2) — never a bare wall clock.
//   R4b  ACTIVE_TURN_PHASES is a named module-scope set (D1.1) — the fold's boundary judgment.
//   R4c  the reset set is the union with the four #67 liveness re-arm kinds (A3, REARM_KINDS mirror).
//   R4d  normalizeDriver accepts hardCapMs === null and the loop condition honors the sentinel (A6, D2.2).
//   R4e  the named verdict WAVE-QUIESCED, both evidence lines, and the CLOSED exit enum of D1.5
//        ('quiesced'/'terminalized_unrecoverable'/'pending_empty'/'stuck_handled') exist —
//        restaged 2026-08-14: 'hard_cap' is OUT of the enum (the operator ruling retired every
//        clock-cap kill; the numeric hardCapMs form refuses at admission — see N1).
//   R5   a member terminalizing unrecoverably hard-breaks the loop (A5, DR-1(a)) with the
//        wave_terminalized_unrecoverable evidence line; the survivor result-sha is still harvested.
//   R6   PRODUCTION_WORKFLOW_DRIVER ships hardCapMs: null (A6, D2.1) — the production cadence is
//        uncapped.
//   P1   PIN — the suite lane driver stays byte-identical (NO hardCapMs key — restaged
//        2026-08-14: the operator ruling retired the 3000ms backstop; quiescence is UNGATED, so
//        the fast policy runs the predicate and settles on terminality) and a settling wave
//        receipts WAVE-OK with the seven-key D6 receipt (F14). Kills an impl that changes the
//        fast policy or drops the D6 shape.
//   P2   PIN — a decision-stuck roster exits fast via the stuck-decision early-break (D3.3/A10),
//        receipts WAVE-INCOMPLETE and NEVER WAVE-QUIESCED. Kills an impl that lets quiescence
//        preempt the stuck-break or misreports a decision-stuck roster.
//   N1   PIN — RESTAGED to the operator ruling (2026-08-14, "timeout/clock based control flows
//        are not appropriate for baton"): a NUMERIC hardCapMs now refuses at admission
//        (workflow_spec_invalid naming the retirement) — the gating question is moot because no
//        clock mode exists; the quiescence predicate runs under every accepted driver.
//   N2   a roster observed to produce meaningful events at a CONTROLLED gap (two content.file_edit
//        events, the second delayMs 400/800) is NOT quiesced at the 120ms floor — the declaration's
//        quiescenceSilenceMs scales with 2× the observed cadence across BOTH scenarios (A2/D1.2), so
//        a bare-constant window cannot satisfy both. The same fixture behaviorally demonstrates the
//        reset set (the edits advance lastProgress.at — A3) and the quiet-window declaration (A4).
//   N3   after a WAVE-QUIESCED declaration no member re-wakes: no member WORK event
//        (lifecycle.turn_started / content.file_edit / task.claimed) lands after the declaration
//        snapshot's quiescenceLastMeaningfulAt (A9/G8). RED at HEAD (no declaration machinery).
//
// Red-first: written against the v2 contract BEFORE implementation. R1-R6 fail at their named stage
// on the current HEAD (the interpreter has no quiescence machinery); P1-P2 are green today and stay
// green under the correct implementation, but fail a plausible wrong one. Fixture idiom mirrors
// wave-observability-red.test.mjs / workflow-as-data-red.test.mjs: a real createDriver +
// BatonApplication + bindBaton, a marker-dispatched MockAdapter scenario double, and the
// decoupled-clocks double (application clock = Date.now() + 130_000) so a parked member reads
// progressClass 'silent' (silenceMs >= PROGRESS_SILENCE_THRESHOLD_MS = 120_000) without any wall-clock
// wait. The application clock is a FIXTURE DOUBLE, not a control — no test waits on elapsed time.
//
// NUL-byte discipline: workflow-interpreter.mjs is NUL-free and read whole for the static pins (R3,
// R4a-e); application.mjs is NUL-bearing and read via 'latin1' for the single R6 region-restricted
// pin. This suite file contains 0 NUL bytes.
//
// No clocks as controls: the only clock-shaped value is the +130_000 app-clock offset that makes the
// fixture's members read 'silent' (a double, not a completion control). Sorted-key literals are in
// ACTUAL sorted order; localeCompare is never used. The watchdog stallMs is 60_000 — far beyond any
// row window, so a parked turn's freshly armed timer never fires (neutralizes the worker watchdog).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const REPO = 'repo-quiescence-suite';

// The suite lane driver — the fast pinned policy the two red suites share, byte-identical to
// workflow-as-data-red.test.mjs:346 (LANE_DRIVER). Restaged 2026-08-14 (operator ruling): the
// hardCapMs: 3000 suite backstop is RETIRED — clock caps never decide the fate of agentic work;
// the fast policy runs the quiescence predicate ungated (its members complete, so it exits
// 'pending_empty' long before any silence window).
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

// F14: the D6 receipt is EXACTLY these seven keys, in ACTUAL sorted order.
const RECEIPT_KEYS = ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'];

// Static source reads. workflow-interpreter.mjs is NUL-free; application.mjs is NUL-bearing and read
// via 'latin1' (the R6 pin is region-restricted to the PRODUCTION_WORKFLOW_DRIVER block).
const INTERPRETER_SRC = readFileSync(new URL('../src/workflow-interpreter.mjs', import.meta.url), 'utf8');
const APPLICATION_SRC = readFileSync(new URL('../src/application.mjs', import.meta.url), 'latin1');

// ---------------------------------------------------------------------------
// Fixture (hermetic mkdtemp repos; t.after cleanup; no network / real provider / host state).
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-qs-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
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
    command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// A marker-dispatched MockAdapter scenario double. The card override `turnCompletion: 'pausable'` is
// applied ONLY for the park rows (R1/R2): a completed turn then parks the member instead of
// finalizing, and the first edit's delayMs lets lifecycle.turn_completed land after the wave's
// steering.registered record (deterministic park — verified 5/5 at HEAD, no provider_failure race).
// The modelSelection override is deliberately NOT touched: overriding it breaks route resolution in
// the runWorkflow path (member fails terminal:provider_failure at spawn).
class ScenarioAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, pausable = false, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this._pausable = pausable;
  }
  card() {
    return this._pausable ? { ...super.card(), turnCompletion: 'pausable' } : super.card();
  }
  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }
  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker] ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    return super.spawn(worker, brief, { ...options, scenario: JSON.parse(JSON.stringify(scenario)) });
  }
}

async function fixture(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  mkdirSync(join(repo, 'specs'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    // stallMs 60_000: far beyond any row window, so a parked turn's armed timer never fires.
    watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
    progressNudgeWindowMs: 60_000_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: { default: PROFILE }, defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('q-planner'), dispatcher: principalOf('q-dispatcher'),
      observer: principalOf('q-observer'),
    },
    authorize: async () => true,
    // Decoupled-clocks double: the application clock runs 130s ahead of the coordination log's real
    // timestamps, so a parked member reads silenceMs >= 120_000 → progressClass 'silent' with no
    // wall-clock wait. A fixture double, never a completion control.
    clock: () => new Date(Date.now() + 130_000).toISOString(),
  });
  const baton = bindBaton(application, principalOf('q-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('q-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter, coordination: driver.coordination };
}

function writeObjective(repo, role, text) {
  writeFileSync(join(repo, 'objectives', `${role}.md`), `${text}\n(marker:${role})\n`);
}

function member(role) {
  return {
    role, exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], objectiveRef: `objectives/${role}.md`, report: `reports/${role}.md`,
  };
}

const uncappedDriver = () => ({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: null });

// ===========================================================================
// R1 — quiet full roster → WAVE-QUIESCED (A1/A8; stage: quiescence-verdict-missing)
// ===========================================================================

describe('R1 (stage[quiescence-verdict-missing])', () => {
  it('a quiet full roster receipts WAVE-QUIESCED with basis "quiesced" and per-member quiescence evidence', async (t) => {
    const adapter = new ScenarioAdapter({
      harness: 'mock', pausable: true,
      scenariosByMarker: {
        'q-a': { outcome: 'completed', summary: 'park', edits: [{ path: 'reports/q-a.md', content: 'a\n', delayMs: 30 }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'write the q-a report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-r1', members: [member('q-a')],
      steering: {}, harvest: { paths: ['reports/q-a.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: uncappedDriver() });

    assert.equal(receipt.verdict, 'WAVE-QUIESCED',
      'stage[quiescence-verdict-missing]: a quiet roster receipts the named quiescence verdict, not WAVE-INCOMPLETE-by-clock (A1)');
    assert.equal(receipt.basis, 'quiesced',
      'stage[quiescence-verdict-missing]: the quiesced basis is named, not the manifestDigest (D1.5)');
    assert.ok((receipt.steering ?? []).some((entry) => entry?.evidence === 'wave_quiesced'),
      'stage[quiescence-verdict-missing]: the named evidence line { evidence: "wave_quiesced" } rides the steering channel (G7)');
    const outcome = receipt.outcomes?.[0];
    assert.ok(typeof outcome?.quiescenceLastMeaningfulAt === 'string' && outcome?.quiescenceLastMeaningfulAt.length > 0,
      'stage[quiescence-verdict-missing]: the outcome carries the quiescenceLastMeaningfulAt additive field (OQ5)');
    assert.ok(typeof outcome?.quiescenceSilenceMs === 'number' && outcome?.quiescenceSilenceMs > 0,
      'stage[quiescence-verdict-missing]: the outcome carries the quiescenceSilenceMs additive field (OQ5)');
    assert.equal(outcome?.progressClass, 'silent',
      'stage[quiescence-verdict-missing]: the outcome carries the declaration progressClass "silent"');
    assert.deepEqual(Object.keys(receipt).sort(), RECEIPT_KEYS,
      'stage[quiescence-verdict-missing]: the D6 receipt stays EXACTLY the seven sorted keys (F14)');
    const qaHarvest = (receipt.harvest ?? []).find((h) => h.path === 'reports/q-a.md');
    assert.ok(qaHarvest?.missed === true && qaHarvest?.code === 'harvest_miss',
      'stage[quiescence-verdict-missing]: a quiesced member with no committed result sha reports harvest_miss (D3.1)');
  });
});

// ===========================================================================
// R2 — mid-turn + quiet → totality terminalizes the phase-stuck member (A12; stage: totality-evidence-missing)
// ===========================================================================

describe('R2 (stage[totality-evidence-missing])', () => {
  it('a mid-turn member + quiet member never quiesces; the phase-stuck member is terminalized-unrecoverable', async (t) => {
    const adapter = new ScenarioAdapter({
      harness: 'mock', pausable: true,
      scenariosByMarker: {
        // q-a stays mid-turn for the whole drive (60s edit delay halts in an ACTIVE turn — the
        // outline renders phase 'running', which is NOT the literal ACTIVE_TURN_PHASES vocabulary
        // but IS mid-turn; fold judgment call 1 requires the landing to re-check the real phase names).
        'q-a': { outcome: 'completed', summary: 'mid-turn', edits: [{ path: 'reports/q-a.md', content: 'a\n', delayMs: 60_000 }] },
        'q-b': { outcome: 'completed', summary: 'quiet', edits: [{ path: 'reports/q-b.md', content: 'b\n', delayMs: 30 }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'write the q-a report');
    writeObjective(fx.repo, 'q-b', 'write the q-b report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-r2', members: [member('q-a'), member('q-b')],
      steering: {}, harvest: { paths: ['reports/q-a.md', 'reports/q-b.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: uncappedDriver() });

    assert.notEqual(receipt.verdict, 'WAVE-QUIESCED',
      'stage[totality-evidence-missing]: a roster with a mid-turn member is NEVER declared quiesced (D1.1 phase gate)');
    const term = (receipt.steering ?? []).find((entry) => entry?.evidence === 'wave_terminalized_unrecoverable');
    assert.ok(term,
      'stage[totality-evidence-missing]: a phase-stuck (active-turn phase + silent, no advance) member is terminalized-unrecoverable with the named evidence line (A12 leg b)');
    assert.ok(typeof term.role === 'string' && term.role.length > 0,
      'stage[totality-evidence-missing]: the terminalized member is named by role');
  });
});

// ===========================================================================
// R5 — hard-break on an unrecoverable terminal (A5/DR-1(a); stage: hard-break-evidence-missing)
// ===========================================================================

describe('R5 (stage[hard-break-evidence-missing])', () => {
  it('a member terminalizing unrecoverably hard-breaks the loop and the survivor result-sha is harvested', async (t) => {
    const adapter = new ScenarioAdapter({
      harness: 'mock',
      scenariosByMarker: {
        // Amended 2026-08-14 (impl-row feedback, #163): the v2 fixture failed q-a instantly and
        // assumed the survivor finalized in the same poll batch — an unverified timing read
        // (measured false on a loaded machine: the hard-break killed the survivor mid-turn and
        // its pin never minted). q-a now churns a 300 ms in-turn edit before failing, so the
        // survivor's completion is deterministic UNDER LOAD and the row pins the law (hard-break
        // + survivor harvest), not a scheduling race.
        'q-a': { outcome: 'failed', summary: 'nope', edits: [{ path: 'reports/q-a.md', content: 'doomed\n', delayMs: 300 }] },
        'q-b': { outcome: 'completed', summary: 'done', edits: [{ path: 'reports/q-b.md', content: 'x\n' }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'fail the task');
    writeObjective(fx.repo, 'q-b', 'complete the task');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-r5', members: [member('q-a'), member('q-b')],
      steering: {}, harvest: { paths: ['reports/q-a.md', 'reports/q-b.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: uncappedDriver() });

    assert.equal(receipt.verdict, 'WAVE-INCOMPLETE',
      'stage[hard-break-evidence-missing]: an unrecoverable terminal leaves the wave WAVE-INCOMPLETE over the manifestDigest basis (D1.4)');
    const term = (receipt.steering ?? []).find((entry) => entry?.evidence === 'wave_terminalized_unrecoverable');
    assert.ok(term,
      'stage[hard-break-evidence-missing]: the unrecoverable terminal pushes the wave_terminalized_unrecoverable evidence line (A5)');
    assert.equal(term.role, 'q-a',
      'stage[hard-break-evidence-missing]: the failed member is named by role');
    const survivor = (receipt.outcomes ?? []).find((o) => o.role === 'q-b');
    assert.ok(typeof survivor?.resultSha === 'string' && survivor?.resultSha.length > 0,
      'stage[hard-break-evidence-missing]: the survivor result-sha is still harvested (A5, survivor result-shas not worktree state)');
    const survivorHarvest = (receipt.harvest ?? []).find((h) => h.path === 'reports/q-b.md');
    assert.ok(survivorHarvest?.ok === true,
      'stage[hard-break-evidence-missing]: the survivor harvest entry receipts ok');
  });
});

// ===========================================================================
// Static source pins — R3, R4a-e, R6 (red at HEAD, byte-string/EXISTENCE anchors only)
// ===========================================================================

describe('R3 (stage[readview-projection-missing])', () => {
  it('the landed readView return projects lastProgress / silenceMs / progressClass from the outline (A7/B3)', () => {
    const start = INTERPRETER_SRC.indexOf('async function readView');
    assert.ok(start !== -1, 'readView function exists (fixture anchor)');
    const end = INTERPRETER_SRC.indexOf('const TERMINAL_PHASES', start);
    assert.ok(end !== -1, 'readView is followed by TERMINAL_PHASES (fixture anchor)');
    const readViewBody = INTERPRETER_SRC.slice(start, end);
    for (const field of ['lastProgress', 'silenceMs', 'progressClass']) {
      assert.ok(readViewBody.includes(field),
        `stage[readview-projection-missing]: the landed readView return projects ${field} from the outline (B3)`);
    }
  });
});

describe('R4a (stage[quiescence-floor-missing])', () => {
  it('the window floor is the named evidence-count constant and the cadence term is observed, never a bare wall clock (A2/D1.2)', () => {
    assert.ok(INTERPRETER_SRC.includes('QUIESCENCE_MIN_SILENT_POLLS'),
      'stage[quiescence-floor-missing]: the named window-floor constant QUIESCENCE_MIN_SILENT_POLLS exists (D1.2)');
    assert.ok(INTERPRETER_SRC.includes('maxObservedGapMs'),
      'stage[quiescence-floor-missing]: the cadence term maxObservedGapMs is derived from the roster\'s observed inter-event gaps (A2)');
  });
});

describe('R4b (stage[active-turn-phases-missing])', () => {
  it('ACTIVE_TURN_PHASES is a named module-scope set (D1.1)', () => {
    assert.ok(INTERPRETER_SRC.includes('ACTIVE_TURN_PHASES'),
      'stage[active-turn-phases-missing]: the named active-turn-phase set ACTIVE_TURN_PHASES exists (D1.1, fold judgment call 1)');
  });
});

describe('R4c (stage[reset-set-missing])', () => {
  it('the reset set is the union with the four #67 liveness re-arm kinds (A3/D1.1)', () => {
    for (const kind of ['approval.resolved', 'decision.settled', 'lifecycle.turn_started', 'question.answered']) {
      assert.ok(INTERPRETER_SRC.includes(`'${kind}'`),
        `stage[reset-set-missing]: the liveness re-arm kind ${kind} is in the reset set (D1.1, REARM_KINDS mirror)`);
    }
  });
});

describe('R4d (stage[null-sentinel-missing])', () => {
  it('normalizeDriver accepts the null sentinel and the loop condition honors it (A6/D2.2)', () => {
    assert.ok(INTERPRETER_SRC.includes('hardCapMs === null'),
      'stage[null-sentinel-missing]: normalizeDriver accepts hardCapMs === null and the loop condition honors the sentinel (D2.2)');
  });
});

describe('R4e (stage[quiescence-vocabulary-missing])', () => {
  it('the named verdict, both evidence lines, and the closed exit enum exist (D1.5)', () => {
    assert.ok(INTERPRETER_SRC.includes('WAVE-QUIESCED'),
      'stage[quiescence-vocabulary-missing]: the named quiescence verdict WAVE-QUIESCED exists (D1.5)');
    assert.ok(INTERPRETER_SRC.includes('wave_quiesced'),
      'stage[quiescence-vocabulary-missing]: the wave_quiesced evidence line exists');
    assert.ok(INTERPRETER_SRC.includes('wave_terminalized_unrecoverable'),
      'stage[quiescence-vocabulary-missing]: the wave_terminalized_unrecoverable evidence line exists');
    for (const exit of ['quiesced', 'terminalized_unrecoverable', 'pending_empty', 'stuck_handled']) {
      assert.ok(INTERPRETER_SRC.includes(`'${exit}'`),
        `stage[quiescence-vocabulary-missing]: the closed driveLane exit enum contains ${exit} (D1.5 refusal vocabulary — 'hard_cap' is retired under the 2026-08-14 operator ruling)`);
    }
  });
});

describe('R6 (stage[production-driver-uncapped-missing])', () => {
  it('PRODUCTION_WORKFLOW_DRIVER ships hardCapMs: null — the production cadence is uncapped (A6/D2.1)', () => {
    const marker = APPLICATION_SRC.indexOf('const PRODUCTION_WORKFLOW_DRIVER');
    assert.ok(marker !== -1, 'PRODUCTION_WORKFLOW_DRIVER exists (fixture anchor)');
    const block = APPLICATION_SRC.slice(marker, APPLICATION_SRC.indexOf('});', marker));
    assert.ok(block.includes('hardCapMs: null'),
      'stage[production-driver-uncapped-missing]: PRODUCTION_WORKFLOW_DRIVER ships hardCapMs: null (D2.1)');
  });
});

// ===========================================================================
// Preservation guardrails — P1 (lane driver), P2 (stuck-decision). GREEN at HEAD.
// ===========================================================================

describe('P1 (stage[lane-driver-preserved])', () => {
  it('the fast pinned lane policy stays byte-identical and a settling wave receipts WAVE-OK + the seven-key receipt', async (t) => {
    assert.deepEqual(LANE_DRIVER, Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 }),
      'stage[lane-driver-preserved]: the suite lane driver stays byte-identical (no clock key — the #163 law, restaged 2026-08-14)');
    const adapter = new ScenarioAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'p1-a': { outcome: 'completed', summary: 'done', edits: [{ path: 'reports/p1-a.md', content: 'a\n' }] },
        'p1-b': { outcome: 'completed', summary: 'done', edits: [{ path: 'reports/p1-b.md', content: 'b\n' }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'p1-a', 'write the p1-a report');
    writeObjective(fx.repo, 'p1-b', 'write the p1-b report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-p1', members: [member('p1-a'), member('p1-b')],
      steering: {}, harvest: { paths: ['reports/p1-a.md', 'reports/p1-b.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER });
    assert.equal(receipt.verdict, 'WAVE-OK',
      'stage[lane-driver-preserved]: a settling wave receipts WAVE-OK on the fast pinned policy (A11)');
    assert.deepEqual(Object.keys(receipt).sort(), RECEIPT_KEYS,
      'stage[lane-driver-preserved]: the D6 receipt stays EXACTLY the seven sorted keys (F14)');
  });
});

describe('P2 (stage[stuck-decision-preserved])', () => {
  it('a decision-stuck roster exits via the stuck-decision early-break, never WAVE-QUIESCED (D3.3/A10)', async (t) => {
    const ask = {
      kind: 'decision', question: 'Which path?',
      options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
      allowFreeResponse: false, recommended: null, deadlineMs: 120_000, afterEditIndex: 1,
      onAnswerEdits: [{ path: 'reports/p2-a-after.md', content: 'after\n' }],
    };
    const adapter = new ScenarioAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'p2-a': { outcome: 'completed', summary: 'decide', edits: [{ path: 'reports/p2-a.md', content: 'a\n' }], ask },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'p2-a', 'write the p2-a report, then decide');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-p2', members: [member('p2-a')],
      steering: { answerDecisions: { policy: { 'No such question anywhere': 'opt-a' } } },
      harvest: { paths: ['reports/p2-a.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER });
    assert.equal(receipt.verdict, 'WAVE-INCOMPLETE',
      'stage[stuck-decision-preserved]: a decision-stuck roster receipts WAVE-INCOMPLETE (D3.3)');
    assert.notEqual(receipt.verdict, 'WAVE-QUIESCED',
      'stage[stuck-decision-preserved]: a decision-stuck roster is NEVER reported WAVE-QUIESCED (D1.5)');
    const deferred = (receipt.steering ?? []).find((entry) => entry?.trigger === 'answerDecisions' && entry?.deferred === true);
    assert.ok(deferred,
      'stage[stuck-decision-preserved]: the stuck-decision early-break receipts the deferred decision — the D3.3 exit, evaluated before any quiescence check');
  });
});

// ===========================================================================
// Extended pin coverage — N1 (null-gating, A13), N2 (cadence-derived window, A2),
// N3 (post-declaration re-wake, A9).
// ===========================================================================

describe('N1 (stage[clock-cap-retired])', () => {
  it('a numeric hardCapMs refuses at admission naming the retirement — no clock mode exists (operator ruling 2026-08-14)', async (t) => {
    // RESTAGED to the operator ruling ("timeout/clock based control flows are not appropriate for
    // baton — an arbitrary cap/limit, just in general"): the v2 contract's null-gating question is
    // moot because no numeric clock mode survives admission. The refusal is loud, typed, and names
    // the law — a caller that still asks for a cap learns the settle is quiescence-derived.
    const adapter = new ScenarioAdapter({
      harness: 'mock', pausable: true,
      scenariosByMarker: {
        'q-a': { outcome: 'completed', summary: 'park', edits: [{ path: 'reports/q-a.md', content: 'a\n', delayMs: 30 }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'write the q-a report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-n1', members: [member('q-a')],
      steering: {}, harvest: { paths: ['reports/q-a.md'] },
    };
    await assert.rejects(
      () => fx.baton.recipes.runWorkflow(spec, { driver: { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 } }),
      (error) => error?.code === 'workflow_spec_invalid' && /hardCapMs/.test(error?.message ?? ''),
      'stage[clock-cap-retired]: a numeric hardCapMs refuses workflow_spec_invalid naming the retired key — no clock mode exists (the #163 law, operator ruling 2026-08-14)',
    );
  });
});

describe('N2 (stage[cadence-derived-window-missing])', () => {
  it('a roster observed producing at a controlled gap quiesces only after 2× its cadence, and the window scales across scenarios (A2/D1.2)', async (t) => {
    // Each wave is a pausable member whose scenario applies two edits: the first immediately, the
    // second after a controlled delayMs. Each edit lands a content.file_edit → evidence.mapped event
    // (cat 'evidence'), so the roster's observed max inter-event gap ≈ delayMs. The quiescence window
    // = max(2 * maxObservedGapMs, 8 * pollIntervalMs), so a correct landing quiesces only once the
    // member has been silent for ≈ 2 * delayMs. A bare-constant window cannot satisfy two scenarios
    // with different delays — the cross-scenario ordering kills it (A2's amended discriminator).
    async function runCadence(delayMs) {
      const adapter = new ScenarioAdapter({
        harness: 'mock', pausable: true,
        scenariosByMarker: {
          'q-a': {
            outcome: 'completed', summary: 'cadence',
            edits: [
              { path: 'reports/q-a.md', content: 'a\n' },
              { path: 'reports/q-a.md', content: 'b\n', delayMs },
            ],
          },
        },
      });
      const fx = await fixture(t, adapter);
      writeObjective(fx.repo, 'q-a', 'write the q-a report');
      const spec = {
        schemaVersion: 1, idempotencyKey: `qs-n2-${delayMs}`, members: [member('q-a')],
        steering: {}, harvest: { paths: ['reports/q-a.md'] },
      };
      const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: uncappedDriver() });
      assert.equal(receipt.verdict, 'WAVE-QUIESCED',
        `stage[cadence-derived-window-missing]: a roster that went quiet after producing is declared quiesced (delayMs ${delayMs})`);
      const outcome = receipt.outcomes?.[0];
      assert.ok(typeof outcome?.quiescenceSilenceMs === 'number' && outcome?.quiescenceSilenceMs > 0,
        `stage[cadence-derived-window-missing]: the declaration carries quiescenceSilenceMs > 0 (delayMs ${delayMs})`);
      return outcome.quiescenceSilenceMs;
    }

    const s400 = await runCadence(400);
    // 2×400 = 800ms minimum. The floor is 8*15 = 120ms, so a landing that ignores the observed
    // cadence (or a bare 120ms constant) can never reach this.
    assert.ok(s400 >= 2 * 400 - 150,
      'stage[cadence-derived-window-missing]: a roster observed 400ms apart is not quiesced at the floor — only at ≥ 2× its own cadence (A2)');
    const s800 = await runCadence(800);
    assert.ok(s800 >= 2 * 800 - 150,
      'stage[cadence-derived-window-missing]: a roster observed 800ms apart is not quiesced at 800ms — only at ≥ 2× its own cadence (A2)');
    assert.ok(s800 > s400 + 300,
      'stage[cadence-derived-window-missing]: the window scales with the observed cadence — a bare constant cannot satisfy both scenarios (A2\'s amended discriminator)');
  });
});

describe('N3 (stage[post-declaration-rewake-missing])', () => {
  it('after a WAVE-QUIESCED declaration no member emits a work event past the declaration snapshot (A9/G8)', async (t) => {
    const adapter = new ScenarioAdapter({
      harness: 'mock', pausable: true,
      scenariosByMarker: {
        'q-a': { outcome: 'completed', summary: 'park', edits: [{ path: 'reports/q-a.md', content: 'a\n', delayMs: 30 }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'write the q-a report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-n3', members: [member('q-a')],
      steering: {}, harvest: { paths: ['reports/q-a.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: uncappedDriver() });

    assert.equal(receipt.verdict, 'WAVE-QUIESCED',
      'stage[post-declaration-rewake-missing]: the declaration is the loop exit (A1/D3.2)');
    const outcome = receipt.outcomes?.[0];
    assert.ok(typeof outcome?.quiescenceLastMeaningfulAt === 'string',
      'stage[post-declaration-rewake-missing]: the declaration snapshot names the last meaningful event (OQ5)');
    const declaredAtMs = Date.parse(outcome.quiescenceLastMeaningfulAt);
    // The stop sequence (run.stop_admitted / kill.* / cleanup) legitimately lands AFTER the
    // declaration; a member WORK event (a re-wake: a new turn_started, an edit, or a new task
    // claim) must not. +50ms tolerance for event-vs-snapshot ordering in the shared log.
    const workKinds = ['lifecycle.turn_started', 'content.file_edit', 'task.claimed'];
    const reWakes = fx.coordination.events().filter((ev) => {
      const p = ev.payload ?? {};
      return ev.kind === 'evidence.mapped' && workKinds.includes(p.kind)
        && typeof p.worker === 'string' && Date.parse(ev.ts) > declaredAtMs + 50;
    });
    assert.deepEqual(reWakes, [],
      'stage[post-declaration-rewake-missing]: no member re-wakes after the declaration (A9/G8 — wave.close stops every member)');
  });
});
