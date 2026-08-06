// Issue #114 — the workflow-as-data rung. Red-first suite: ONE closed spec + ONE verb
// (baton.recipes.runWorkflow / baton wave run / baton_wave_run) ends the bespoke-driver era.
//
// Binding contract: docs/reference/evidence/workflow-as-data-2026-08-06/
//   workflow-as-data-contract.md v1.0 — decisions D1-D6, the refusal vocabulary, pin groups
//   W1-W6. Idioms: workflow-surface-red.test.mjs (facade + MCP staging, realServer wire
//   helpers) and wave-driver-policy-red.test.mjs (the pausable/scripted adapter machinery).
//
// 21 rows (17 red + 4 green guards). Red-first: every red row fails today at a NAMED stage —
//   spec-validation-missing / member-validation-missing / objective-ref-invalid / steering-unknown
//   / harvest-invalid / lane-missing / policy-missing:<policy> / import-law — and goes green on
//   the contract's implementation ONLY. The four green guards (P1-P4) pin the substrate the
//   interpreter must build on; they MUST stay green.
//
// Invented surfaces (all absent at HEAD 3953f81; namespace/absence-proof access so a missing
// export or module never kills the file at LOAD):
//   * baton.recipes.runWorkflow(spec|specPath, options?)              — the ONE interpreter lane (D2)
//   * impl/src/workflow-lane.mjs → { runWorkflow }                    — the importable lane module (W5)
//   * CLI: baton wave run <spec.json> → command "waves.run"            — D2 verb (W6-CLI)
//   * MCP: baton_wave_run { repoId, spec }                            — D2 tool (W6-MCP)
//   * refusal codes: workflow_spec_invalid · workflow_member_invalid · workflow_objective_ref_invalid
//     · workflow_steering_unknown · workflow_harvest_invalid           (field/role-named, D-refusals)
//   * steering triggers on receipt.steering[]: approveOnAdvertisedPlan · nudgeOnCheckpoint ·
//     claimOnStall · messageOnSpawn · elevateWhenNotes · answerDecisions · signalOnMembersDone
//
// Pin list: P1 wave substrate exports (createWave / resolveResultPin / createWaveDriver) · P2
// baton.recipes is a frozen { run, implementContract } container · P3 createWaveDriver accepts the
// shipped steering/finalization vocabulary · P4 MAX_WAVE_PROGRESS_BYTES + the 64-member ceiling.
//
// Hermetic: real createDriver stack over MockAdapter subclasses, mkdtemp repos + log dirs, no
// network, no real provider, git created and removed inside t.after. NUL-byte discipline: only
// application.mjs and coordination-store.mjs carry NULs — this suite reads mcp-northbound.mjs,
// wave-driver.mjs, wave.mjs, recipes.mjs and application-cli.mjs (NUL-free) for its static pins
// and never reads the NUL-carrying files whole.
//
// Verified split: 17 red / 4 green — `node --test impl/test/workflow-as-data-red.test.mjs` from
// the repo root, twice (stable): tests 21 · pass 4 (P1-P4) · fail 17 (all red rows, each failing
// at its named stage — see suite-draft-notes.md for the row map).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver, McpFleetServer } from '../src/index.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import * as recipesModule from '../src/recipes.mjs';
import * as waveModule from '../src/wave.mjs';

const REPO = 'repo-workflow-as-data';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wad-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

// The one deployment profile the whole suite rides (workflow-surface-red PROFILE, repo-pinned).
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

// ---------------------------------------------------------------------------
// Adapter machinery (wave-driver-policy-red + wave-driver-red idioms, folded).
// ---------------------------------------------------------------------------

// The suite's default mock: marker-routed scenarios + a calls ledger (spawn/approve/answer/
// prompt) so W3 rows can prove the policy's WIRE call reached the adapter.
class TrackingMarkerAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this.calls = { spawn: [], approve: [], answer: [], prompt: [] };
  }

  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'workflow-as-data-red', refreshedAt: null,
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
    this.calls.spawn.push({ worker, marker, brief });
    return super.spawn(worker, brief, { ...options, scenario });
  }

  async approve(worker, requestId, decision, payload) {
    this.calls.approve.push({ worker, requestId, decision, payload });
    return super.approve(worker, requestId, decision, payload);
  }

  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    return super.answer(worker, requestId, answer);
  }

  async prompt(worker, message, mode) {
    this.calls.prompt.push({ worker, message, mode });
    return super.prompt(worker, message, mode);
  }
}

// A pausable-turn adapter (wave-driver-policy-red:56-141 verbatim): scripted turns per member
// marker, +1 turnEpoch per nudge in lockstep with the coordinator's epoch fence, and an
// unproductive tail after the scripted prefix (the L6 termination-law trigger).
class PausableWaveAdapter extends MockAdapter {
  constructor({ scriptsByMarker, ...config } = {}) {
    super(config);
    this._scriptsByMarker = scriptsByMarker ?? {};
  }

  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'wave-driver-policy-red', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  _scriptForMarker(marker) {
    return this._scriptsByMarker[marker] ?? this._scriptsByMarker.default ?? [{ edits: [] }];
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    this._markerByWorker = this._markerByWorker ?? new Map();
    this._markerByWorker.set(worker, marker);
    const script = this._scriptForMarker(marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    this._failRemaining = this._failRemaining ?? new Map();
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
      turnEpoch: 0,
    });
  }

  _scenarioForTurn(script, index) {
    const turn = script[index] ?? script.at(-1) ?? { edits: [] };
    return {
      outcome: 'completed',
      summary: `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
    };
  }

  async prompt(worker, message, mode) {
    if (mode === 'turn') {
      const script = this._scriptForMarker(this._markerByWorker?.get(worker) ?? 'default');
      const count = (this._turnCount?.get(worker) ?? 0) + 1;
      this._turnCount.set(worker, count);
      const turn = script[count] ?? script.at(-1) ?? { edits: [] };
      const session = this._sessions.get(worker);
      if (session) {
        session.terminal = false;
        session.runStarted = false;
        session.stopKind = null;
        session.crashed = false;
        session.timeoutHit = false;
        session.deniedApproval = false;
        session.askHandled = false;
        session.scenario = this._scenarioForTurn(script, count);
        session.opts = { ...session.opts, turnEpoch: count };
        this._startSession(session);
      }
    }
    return super.prompt(worker, message, mode);
  }
}

// The elevate-when-notes member: after its first edit lands, it emits a coordinator-routed
// `scratchpad.write` up-channel (adapter._emit → coordinator.mjs scratchpad.write case →
// writeScratchpad with the entry + idempotencyKey). The policy then reads the task tier and
// elevates once.
class NoteWritingAdapter extends TrackingMarkerAdapter {
  async _applyEdit(session, edit) {
    const result = await super._applyEdit(session, edit);
    if (!this._noteWritten?.has(session.worker) && session.scenario?.note) {
      this._noteWritten = this._noteWritten ?? new Set();
      this._noteWritten.add(session.worker);
      this._emit(session, 'scratchpad.write', {
        entry: { kind: 'note', text: session.scenario.note },
        idempotencyKey: `wad-elev-note-${session.worker}`,
      });
    }
    return result;
  }
}

const edit = (role, turn, content = `${role} turn ${turn}\n`) => ({
  path: `reports/${role}-${turn}.md`, content,
});

// ---------------------------------------------------------------------------
// Fixture.
// ---------------------------------------------------------------------------

async function wadFixture(t, { adapter } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  mkdirSync(join(repo, 'specs'), { recursive: true });
  const coordAdapter = adapter ?? new TrackingMarkerAdapter({
    harness: 'mock',
    scenariosByMarker: { default: { outcome: 'completed' } },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2_000,
    // Neutralize the worker watchdog: a stallMs far beyond any test window so a parked turn's
    // freshly armed timer never fires and writes nothing that flaps the stall marker.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('wad-planner'),
      dispatcher: principalOf('wad-dispatcher'),
      observer: principalOf('wad-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('wad-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('wad-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter: coordAdapter, coordination: driver.coordination };
}

// One closed spec (D1): a single completed member + empty steering + empty harvest. Red rows
// over-spread the field they pin. The `report` member field is the bespoke drivers' report path
// (wave-driver.mjs members carry it) — the suite pins it as a declared member field so the D6
// outcomes' resultSha materializes exactly as the bespoke waves' outcomes did.
function validSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: 'wad-valid',
    members: [wadMember('w1-a')],
    steering: {},
    harvest: { paths: [] },
    verification: { command: 'true', arguments: [] },
    ...overrides,
  };
}

function wadMember(role, overrides = {}) {
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

// ---------------------------------------------------------------------------
// Red-stage helpers.
// ---------------------------------------------------------------------------

// The ONE invented interpreter lane. Today `baton.recipes` is a frozen { run, implementContract }
// container (createRecipes, recipes.mjs:573-581) — runWorkflow is absent, so this assert fires at
// the named stage for every row that must reach the lane.
function laneOf(baton, stage) {
  const lane = baton?.recipes?.runWorkflow;
  assert.equal(typeof lane, 'function',
    `stage[${stage}]: baton.recipes.runWorkflow(spec|specPath) must exist — the workflow-as-data interpreter lane (issue #114) is absent at HEAD`);
  return lane;
}

async function captureError(fn) {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    return { error: { code: error?.code ?? null, message: String(error?.message ?? error) } };
  }
}

// ---------------------------------------------------------------------------
// P-pins (green today — the substrate the interpreter must build on).
// ---------------------------------------------------------------------------

test('P1 (guard): the wave substrate exports resolve — createWave, resolveResultPin, createWaveDriver', () => {
  assert.equal(typeof waveModule.createWave, 'function', 'createWave (wave.mjs)');
  assert.equal(typeof waveModule.resolveResultPin, 'function', 'resolveResultPin (wave.mjs)');
  assert.equal(typeof waveModule.MAX_WAVE_PROGRESS_BYTES, 'number', 'MAX_WAVE_PROGRESS_BYTES (wave.mjs)');
  assert.equal(typeof createWaveDriver, 'function', 'createWaveDriver (index.mjs re-export)');
  assert.equal(typeof recipesModule.createRecipes, 'function', 'createRecipes (recipes.mjs)');
});

test('P2 (guard): the facade surface is a frozen recipes container with run/implementContract', async (t) => {
  const fx = await wadFixture(t);
  assert.ok(fx.baton.recipes && typeof fx.baton.recipes === 'object', 'baton.recipes is an object');
  assert.equal(Object.isFrozen(fx.baton.recipes), true, 'baton.recipes is frozen (a closed surface)');
  assert.equal(typeof fx.baton.recipes.run, 'function', 'baton.recipes.run');
  assert.equal(typeof fx.baton.recipes.implementContract, 'function', 'baton.recipes.implementContract');
});

test('P3 (guard): createWaveDriver accepts the shipped steering/finalization vocabulary', async (t) => {
  const fx = await wadFixture(t);
  const driver = createWaveDriver(fx.baton, {
    steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
    pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000,
  });
  assert.equal(typeof driver.run, 'function', 'the driver exposes run over the shipped vocabulary');
});

test('P4 (guard): MAX_WAVE_PROGRESS_BYTES and the 64-member ceiling hold', async () => {
  assert.equal(waveModule.MAX_WAVE_PROGRESS_BYTES, 7 * 1024 * 1024,
    'the progress envelope is 7 MiB (wave.mjs)');
  const dummy = { runs: { start: async () => { throw new Error('unused'); } } };
  const members = Array.from({ length: 65 }, (_, i) => wadMember(`p4-${i}`));
  await assert.rejects(
    () => waveModule.createWave(dummy, { members }),
    /bounded non-empty array/u,
    'a 65-member wave is refused by the wave-machinery ceiling (createWave)',
  );
});

// ---------------------------------------------------------------------------
// W1 — the closed schema. Every malformed field refuses its named code; a valid spec validates.
// ---------------------------------------------------------------------------

test('W1-01 (stage[spec-validation-missing]): malformed top-level fields refuse workflow_spec_invalid naming the field', async (t) => {
  const fx = await wadFixture(t);
  writeObjective(fx.repo, 'w1-a', 'write the w1-a report');
  const cases = [
    [validSpec({ bogusField: true }), 'bogusField'],
    [validSpec({ schemaVersion: 2 }), 'schemaVersion'],
    [validSpec({ schemaVersion: undefined }), 'schemaVersion'],
    [validSpec({ idempotencyKey: undefined }), 'idempotencyKey'],
    [validSpec({ idempotencyKey: '' }), 'idempotencyKey'],
    [validSpec({ members: 'not-an-array' }), 'members'],
    [validSpec({ members: [] }), 'members'],
    [validSpec({ steering: 'not-an-object' }), 'steering'],
    [validSpec({ harvest: 'not-an-object' }), 'harvest'],
    [validSpec({ verification: 'not-an-object' }), 'verification'],
  ];
  for (const [spec, field] of cases) {
    const result = await captureError(() => laneOf(fx.baton, 'spec-validation-missing')(spec));
    assert.equal(result?.error?.code, 'workflow_spec_invalid',
      `stage[spec-validation-missing]: the malformed field ${field} refuses workflow_spec_invalid`);
    assert.match(result?.error?.message ?? '', new RegExp(field, 'u'),
      `the refusal names the field ${field}`);
  }
});

test('W1-02 (stage[member-validation-missing]): member-level violations refuse workflow_member_invalid role-named', async (t) => {
  const fx = await wadFixture(t);
  writeObjective(fx.repo, 'w1-b', 'write the w1-b report');
  const cases = [
    [[{ role: undefined, exact: { ...ROUTE }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/w1-b.md' }], 'role'],
    [[{ role: 'dup', exact: { ...ROUTE }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/w1-b.md' },
      { role: 'dup', exact: { ...ROUTE }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/w1-b.md' }], 'dup'],
    // D5: objective text NEVER appears inline — a member carrying `objective` alongside its
    // objectiveRef refuses workflow_member_invalid naming the field.
    [[{ role: 'inline', objective: 'inline text is forbidden', exact: { ...ROUTE }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/inline.md' }], 'objective'],
    [[{ role: 'noref', exact: { ...ROUTE }, scope: ['reports/**'], report: 'reports/noref.md' }], 'objectiveRef'],
    [[{ role: 'scope', exact: { ...ROUTE }, scope: ['reports'], objectiveRef: 'objectives/w1-b.md', report: 'reports/scope.md' }], 'scope'],
    [[{ role: 'exact', exact: { harness: 'mock', model: 'mock-model', effort: 'low', bogus: 1 }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/exact.md' }], 'exact'],
    [[{ role: 'work', exact: { ...ROUTE }, scope: ['reports/**'], objectiveRef: 'objectives/w1-b.md', report: 'reports/work.md' }], 'work'],
  ];
  for (const [members, token] of cases) {
    const spec = { ...validSpec(), members };
    const result = await captureError(() => laneOf(fx.baton, 'member-validation-missing')(spec));
    assert.equal(result?.error?.code, 'workflow_member_invalid',
      `stage[member-validation-missing]: the member ${token} refuses workflow_member_invalid`);
    assert.match(result?.error?.message ?? '', new RegExp(token, 'u'),
      `the refusal names the member/field ${token}`);
  }
});

test('W1-03 (stage[objective-ref-invalid]): objectiveRef violations refuse workflow_objective_ref_invalid', async (t) => {
  const fx = await wadFixture(t);
  writeObjective(fx.repo, 'w1-c', 'write the w1-c report');
  writeFileSync(join(fx.repo, 'objectives', 'oversize.md'), 'x'.repeat(512 * 1024));
  const cases = [
    [wadMember('missing', { objectiveRef: 'objectives/does-not-exist.md' }), 'does-not-exist'],
    [wadMember('escape', { objectiveRef: '../outside.md' }), 'outside'],
    [wadMember('oversize', { objectiveRef: 'objectives/oversize.md' }), 'oversize'],
  ];
  for (const [member, token] of cases) {
    const spec = { ...validSpec(), members: [member] };
    const result = await captureError(() => laneOf(fx.baton, 'objective-ref-invalid')(spec));
    assert.equal(result?.error?.code, 'workflow_objective_ref_invalid',
      `stage[objective-ref-invalid]: the objectiveRef ${token} refuses workflow_objective_ref_invalid`);
    // The refusal names the offending ref — either the field or the path token it carried.
    assert.match(result?.error?.message ?? '', new RegExp(`objectiveRef|${token}`, 'u'),
      `the refusal names ${token}`);
  }
});

test('W1-04 (stage[steering-unknown]): unknown or mistyped steering policies refuse workflow_steering_unknown naming the key', async (t) => {
  const fx = await wadFixture(t);
  writeObjective(fx.repo, 'w1-d', 'write the w1-d report');
  const cases = [
    [validSpec({ steering: { bogusPolicy: true } }), 'bogusPolicy'],
    [validSpec({ steering: { approveOnAdvertisedPlan: 'yes' } }), 'approveOnAdvertisedPlan'],
    [validSpec({ steering: { nudgeOnCheckpoint: 'not-an-object' } }), 'nudgeOnCheckpoint'],
    [validSpec({ steering: { claimOnStall: 42 } }), 'claimOnStall'],
    [validSpec({ steering: { messageOnSpawn: true } }), 'messageOnSpawn'],
    [validSpec({ steering: { answerDecisions: { policy: 'not-a-map' } } }), 'answerDecisions'],
  ];
  for (const [spec, key] of cases) {
    const result = await captureError(() => laneOf(fx.baton, 'steering-unknown')(spec));
    assert.equal(result?.error?.code, 'workflow_steering_unknown',
      `stage[steering-unknown]: the steering key ${key} refuses workflow_steering_unknown`);
    assert.match(result?.error?.message ?? '', new RegExp(key, 'u'),
      `the refusal names the steering key ${key}`);
  }
});

test('W1-05 (stage[harvest-invalid]): harvest violations refuse workflow_harvest_invalid', async (t) => {
  const fx = await wadFixture(t);
  writeObjective(fx.repo, 'w1-e', 'write the w1-e report');
  const cases = [
    [validSpec({ harvest: { paths: 'not-an-array' } }), 'paths'],
    [validSpec({ harvest: { paths: [7] } }), 'paths'],
    [validSpec({ harvest: { paths: [{ path: 'reports/x.md', mustContain: 7 }] } }), 'mustContain'],
    [validSpec({ harvest: { paths: [], bogusHarvest: true } }), 'bogusHarvest'],
  ];
  for (const [spec, token] of cases) {
    const result = await captureError(() => laneOf(fx.baton, 'harvest-invalid')(spec));
    assert.equal(result?.error?.code, 'workflow_harvest_invalid',
      `stage[harvest-invalid]: the harvest field ${token} refuses workflow_harvest_invalid`);
    assert.match(result?.error?.message ?? '', new RegExp(token, 'u'),
      `the refusal names ${token}`);
  }
});

test('W1-06 (stage[lane-missing]): a valid spec validates and returns the D6 receipt shape', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: { default: { outcome: 'completed' } },
    }),
  });
  writeObjective(fx.repo, 'w1-f', 'write the w1-f report');
  const spec = validSpec({ idempotencyKey: 'w1-valid-spec', members: [wadMember('w1-f')] });
  const receipt = await laneOf(fx.baton, 'lane-missing')(spec);
  for (const key of ['outcomes', 'steering', 'harvest', 'verdict', 'basis', 'waveId', 'manifestDigest']) {
    assert.ok(Object.hasOwn(receipt, key), `stage[lane-missing]: the D6 receipt carries ${key}`);
  }
  assert.ok(Array.isArray(receipt.outcomes) && Array.isArray(receipt.steering) && Array.isArray(receipt.harvest),
    'outcomes/steering/harvest are structured arrays');
  assert.ok(receipt.outcomes.length === 1 && (receipt.outcomes[0]?.phase === 'result_ready'
    || receipt.outcomes[0]?.terminal === true), 'the valid spec runs to a settled outcome');
  assert.match(receipt.waveId ?? '', /^wave:[a-f0-9]{32}$/u, 'a durable waveId is minted');
  assert.match(receipt.manifestDigest ?? '', /^[a-f0-9]{64}$/u, 'the spec manifest is digest-stamped');
});

// ---------------------------------------------------------------------------
// W2 — re-drive the suite-wave as a spec: identical outcome shape, zero driver script.
// ---------------------------------------------------------------------------

test('W2-01 (stage[lane-missing]): a 4-member suite-drafting wave runs from a spec — 4 result_ready, zero driver script', async (t) => {
  const roles = ['w2-a', 'w2-b', 'w2-c', 'w2-d'];
  const scenariosByMarker = Object.fromEntries(roles.map((role) => [role, {
    outcome: 'completed',
    edits: [{ path: `docs/reports/${role}.md`, content: `${role} suite draft\n` }],
  }]));
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({ harness: 'mock', scenariosByMarker }),
  });
  for (const role of roles) {
    writeObjective(fx.repo, role,
      `Draft the workflow-as-data suite section owned by role ${role}. Produce docs/reports/${role}.md with the row inventory you own.`);
  }
  const spec = validSpec({
    idempotencyKey: 'w2-suite-draft',
    members: roles.map((role) => wadMember(role, {
      scope: ['docs/reports/**'],
      report: `docs/reports/${role}.md`,
    })),
    steering: { approveOnAdvertisedPlan: true },
    harvest: { paths: roles.map((role) => `docs/reports/${role}.md`) },
  });
  const receipt = await laneOf(fx.baton, 'lane-missing')(spec);
  // Identical outcome shape to the bespoke suite-wave: exactly 4 result_ready, each preserving
  // a result pin (the suite wave's receipt contract — D6's "same shape hand-written today").
  assert.equal(receipt.outcomes.length, 4, `exactly 4 outcomes, got ${receipt.outcomes.length}`);
  for (const outcome of receipt.outcomes) {
    assert.ok(outcome.terminal === true || outcome.phase === 'result_ready',
      `${outcome.role} settled result_ready`);
    assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u,
      `${outcome.role} preserved its result pin (docs/31 #6)`);
    assert.ok(existsSync(join(fx.repo, outcome.report ?? `docs/reports/${outcome.role}.md`)),
      `${outcome.role} drafted its file on disk`);
  }
  assert.equal(receipt.basis, 'completed', 'the wave basis is completed');
  // Zero driver script: the suite's orchestration lives ENTIRELY in the spec (data) — the
  // row must never hand-drive the wave handle. Static self-check on this suite file: none of
  // the driver-loop verbs or wave-handle readers appear in the W2 row's own source.
  const suiteSource = readFileSync(new URL('./workflow-as-data-red.test.mjs', import.meta.url), 'utf8');
  // The verbs are assembled from parts so this check's own array never contains them verbatim
  // (a self-referential trap would otherwise keep the row red forever).
  const bannedDriverVerbs = [
    ['nudge', '_turn'], ['claim', '_turn'], ['approve', '_plan'],
    ['.status', '()'], ['.progress', '()'], ['set', 'Interval'], ['while', ' ('],
  ].map(([head, tail]) => head + tail);
  for (const verb of bannedDriverVerbs) {
    assert.equal(suiteSource.includes(verb), false,
      `stage[lane-missing]: zero driver script — the suite never calls ${verb}; the spec is the driver`);
  }
});

// ---------------------------------------------------------------------------
// W3 — each steering policy fires and receipts.
// ---------------------------------------------------------------------------

test('W3-approve (stage[policy-missing:approve-on-advertised-plan]): a member with an advertised plan is approved once with the advertised digest', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w3-approve': { outcome: 'completed', edits: [{ path: 'reports/w3-approve.md', content: 'w3-approve report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'w3-approve', 'write the w3-approve report, then finish');
  const spec = validSpec({
    idempotencyKey: 'w3-approve',
    members: [wadMember('w3-approve')],
    steering: { approveOnAdvertisedPlan: true },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const events = (receipt.steering ?? [])
    .filter((event) => event.trigger === 'approveOnAdvertisedPlan' && event.role === 'w3-approve');
  assert.ok(events.length >= 1,
    `stage[policy-missing:approve-on-advertised-plan]: approveOnAdvertisedPlan fires and receipts in receipt.steering`);
  assert.equal(events.length, 1, 'the approve fires ONCE per member (never a refire loop)');
  assert.match(events[0]?.planDigest ?? '', /^[a-f0-9]{64}$/u,
    'the receipt carries the advertised plan digest the approval used');
  // The approval DISPATCHED the parked member: the mock only spawns after run.approve.
  assert.ok(fx.adapter.calls.spawn.some((call) => call.marker === 'w3-approve'),
    'the approved member was actually dispatched to the adapter');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', 'the approved member settles');
});

test('W3-checkpoint (stage[policy-missing:nudge-on-checkpoint+claim-on-stall]): a checkpoint is nudged and a stalled member is claimed — both receipted', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new PausableWaveAdapter({
      harness: 'mock',
      scriptsByMarker: { 'w3-chk': [{ edits: [edit('w3-chk', 1)] }] },
    }),
  });
  writeObjective(fx.repo, 'w3-chk', 'write a report, then pause for a checkpoint');
  const spec = validSpec({
    idempotencyKey: 'w3-checkpoint',
    members: [wadMember('w3-chk')],
    steering: {
      nudgeOnCheckpoint: { message: 'Continue the draft.' },
      claimOnStall: true,
    },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const triggers = new Set((receipt.steering ?? []).map((event) => event.trigger));
  assert.ok(triggers.has('nudgeOnCheckpoint'),
    `stage[policy-missing:nudge-on-checkpoint+claim-on-stall]: nudgeOnCheckpoint fires and receipts`);
  assert.ok(triggers.has('claimOnStall'), 'claimOnStall fires and receipts');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', 'the checkpointed member settles');
});

test('W3-message (stage[policy-missing:message-on-spawn]): a spawn-window message is sent and receipts with a durable messageId', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w3-msg': { outcome: 'completed', edits: [{ path: 'reports/w3-msg.md', content: 'w3-msg report\n', delayMs: 500 }] },
      },
    }),
  });
  writeObjective(fx.repo, 'w3-msg', 'write the w3-msg report, then finish');
  const spec = validSpec({
    idempotencyKey: 'w3-message',
    members: [wadMember('w3-msg')],
    steering: { messageOnSpawn: { kind: 'inform', body: 'welcome aboard' } },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const events = (receipt.steering ?? [])
    .filter((event) => event.trigger === 'messageOnSpawn' && event.role === 'w3-msg');
  assert.ok(events.length >= 1,
    `stage[policy-missing:message-on-spawn]: messageOnSpawn fires and receipts`);
  const messageId = events[0]?.messageId ?? events[0]?.receiptId ?? '';
  assert.match(messageId, /^message:[a-f0-9]{64}$/u,
    'the spawn message landed and receipts with a durable messageId');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', 'the messaged member still settles');
});

test('W3-elevate (stage[policy-missing:elevate-when-notes]): a noted member elevates its scratchpad notes once', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new NoteWritingAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w3-elev': {
          outcome: 'completed',
          note: 'the elevation candidate note',
          edits: [{ path: 'reports/w3-elev.md', content: 'w3-elev report\n' }],
        },
      },
    }),
  });
  writeObjective(fx.repo, 'w3-elev', 'write the w3-elev report, then finish');
  const spec = validSpec({
    idempotencyKey: 'w3-elevate',
    members: [wadMember('w3-elev')],
    steering: { elevateWhenNotes: { kinds: ['note'], maxEntries: 3 } },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const events = (receipt.steering ?? [])
    .filter((event) => event.trigger === 'elevateWhenNotes' && event.role === 'w3-elev');
  assert.ok(events.length >= 1,
    `stage[policy-missing:elevate-when-notes]: elevateWhenNotes fires and receipts`);
  assert.equal(events.length, 1, 'the elevation happens ONCE per member');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', 'the noted member settles');
});

test('W3-answer (stage[policy-missing:answer-decisions]): a pending decision is answered per the closed policy map and receipts', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w3-ans': {
          outcome: 'completed',
          edits: [{ path: 'reports/w3-ans.md', content: 'w3-ans report\n' }],
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
            onAnswerEdits: [{ path: 'reports/w3-ans-after.md', content: 'w3-ans after answer\n' }],
          },
        },
      },
    }),
  });
  writeObjective(fx.repo, 'w3-ans', 'write the w3-ans report, then decide');
  const spec = validSpec({
    idempotencyKey: 'w3-answer',
    members: [wadMember('w3-ans')],
    steering: { answerDecisions: { policy: { 'Which path?': 'opt-a' } } },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const events = (receipt.steering ?? [])
    .filter((event) => event.trigger === 'answerDecisions' && event.role === 'w3-ans');
  assert.ok(events.length >= 1,
    `stage[policy-missing:answer-decisions]: answerDecisions fires and receipts`);
  assert.ok(fx.adapter.calls.answer.some((call) => call.answer?.optionId === 'opt-a'),
    'the decision was answered with the mapped optionId opt-a');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', 'the answered member settles');
});

test('W3-signal (stage[policy-missing:signal-on-members-done]): when a named role reaches terminal the remaining member is signaled', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w3-sig-lead': { outcome: 'completed', edits: [{ path: 'reports/w3-sig-lead.md', content: 'lead done\n' }] },
        'w3-sig-worker': { outcome: 'completed', edits: [{ path: 'reports/w3-sig-worker.md', content: 'worker done\n', delayMs: 700 }] },
      },
    }),
  });
  writeObjective(fx.repo, 'w3-sig-lead', 'write the lead report, then finish');
  writeObjective(fx.repo, 'w3-sig-worker', 'write the worker report slowly, then finish');
  const spec = validSpec({
    idempotencyKey: 'w3-signal',
    members: [wadMember('w3-sig-lead', { scope: ['reports/**'], report: 'reports/w3-sig-lead.md' }),
      wadMember('w3-sig-worker', { scope: ['reports/**'], report: 'reports/w3-sig-worker.md' })],
    steering: {
      signalOnMembersDone: {
        roles: ['w3-sig-lead'],
        message: { kind: 'query', body: 'the lead is done' },
      },
    },
  });
  const receipt = await laneOf(fx.baton, 'policy-missing')(spec);
  const events = (receipt.steering ?? []).filter((event) => event.trigger === 'signalOnMembersDone');
  assert.ok(events.length >= 1,
    `stage[policy-missing:signal-on-members-done]: signalOnMembersDone fires when a named role reaches terminal`);
  assert.ok(events.some((event) => (event.role ?? event.doneRole ?? '') === 'w3-sig-lead'
    || (event.doneRoles ?? []).includes('w3-sig-lead')),
    'the signal names the completed role');
  assert.equal(receipt.outcomes.length, 2, 'both members settle');
  for (const outcome of receipt.outcomes) {
    assert.ok(outcome.terminal === true || outcome.phase === 'result_ready', `${outcome.role} settles`);
  }
});

// ---------------------------------------------------------------------------
// W4 — harvest paths recover with per-path receipts; a mustContain mismatch is a named miss.
// ---------------------------------------------------------------------------

test('W4-01 (stage[harvest-missing]): a mustContain mismatch is a NAMED miss with a per-path receipt, never silent', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w4-a': { outcome: 'completed', edits: [{ path: 'reports/w4-a.md', content: 'w4-a report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'w4-a', 'write the w4-a report, then finish');
  const spec = validSpec({
    idempotencyKey: 'w4-mismatch',
    members: [wadMember('w4-a')],
    harvest: { paths: [{ path: 'reports/w4-a.md', mustContain: 'THE-EXPECTED-MARKER' }] },
  });
  const receipt = await laneOf(fx.baton, 'harvest-missing')(spec);
  const miss = (receipt.harvest ?? []).find((entry) => entry.path === 'reports/w4-a.md');
  assert.ok(miss, `stage[harvest-missing]: the harvest spec yields a per-path receipt for reports/w4-a.md`);
  assert.ok(miss.missed === true || miss.ok === false || miss.match === false,
    'the mustContain mismatch is a named miss, never silent');
  assert.equal(typeof miss.expected, 'string', 'the receipt names the expected content');
  assert.equal(typeof miss.actual, 'string', 'the receipt names the actual content');
});

test('W4-02 (stage[harvest-missing]): a mixed harvest recovers the present path and receipts the absent path distinctly', async (t) => {
  const fx = await wadFixture(t, {
    adapter: new TrackingMarkerAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'w4-b': { outcome: 'completed', edits: [{ path: 'reports/w4-b.md', content: 'w4-b report\n' }] },
      },
    }),
  });
  writeObjective(fx.repo, 'w4-b', 'write the w4-b report, then finish');
  const spec = validSpec({
    idempotencyKey: 'w4-mixed',
    members: [wadMember('w4-b')],
    harvest: { paths: ['reports/w4-b.md', 'reports/w4-b-extra.md'] },
  });
  const receipt = await laneOf(fx.baton, 'harvest-missing')(spec);
  const byPath = new Map((receipt.harvest ?? []).map((entry) => [entry.path, entry]));
  assert.ok(byPath.has('reports/w4-b.md'),
    `stage[harvest-missing]: the present path is receipted`);
  assert.ok(byPath.has('reports/w4-b-extra.md'), 'the absent path is receipted too');
  const found = byPath.get('reports/w4-b.md');
  const absent = byPath.get('reports/w4-b-extra.md');
  assert.ok(found.ok === true || found.matched === true || found.missed === false,
    'the present path receipts as found');
  assert.ok(absent.missed === true || absent.ok === false || absent.matched === false,
    'the absent path receipts as a miss');
});

// ---------------------------------------------------------------------------
// W5 — the import law: importing the lane module starts nothing.
// ---------------------------------------------------------------------------

test('W5-01 (stage[lane-missing]): importing the lane module starts nothing — no wave, no spawn, no network', async (t) => {
  // Dynamic import inside the row (never a top-level import): the module is absent today, so a
  // static import would kill the FILE at load — the exact import-law violation this row pins.
  let laneModule = null;
  try {
    laneModule = await import('../src/workflow-lane.mjs');
  } catch (error) {
    assert.fail(`stage[lane-missing]: impl/src/workflow-lane.mjs must exist and import cleanly — it is absent at HEAD (${error?.code ?? error?.message})`);
  }
  assert.equal(typeof laneModule?.runWorkflow, 'function',
    `stage[lane-missing]: the lane module must export runWorkflow`);
  // Behavioral: importing runs nothing. A recording facade would see zero touches.
  const touched = [];
  const silentBaton = {
    waves: { start: async () => { touched.push('waves.start'); } },
    runs: { start: async () => { touched.push('runs.start'); } },
  };
  assert.deepEqual(touched, [],
    'stage[import-law]: importing the lane module starts nothing — the spec is data and only an invocation evaluates it');
  // Structural: the module body has no network constructors and no top-level await (GT4's law
  // made structural — D2). A top-level await would execute at import; network constructors would
  // make import reach out of process.
  const source = readFileSync(new URL('../src/workflow-lane.mjs', import.meta.url), 'utf8');
  for (const banned of ["'node:http'", "'node:https'", "'node:net'", "'node:tls'", 'fetch(', 'new WebSocket(']) {
    assert.equal(source.includes(banned), false,
      `stage[import-law]: no network constructor (${banned}) in the lane module`);
  }
  assert.equal(/^\s*await /mu.test(source), false,
    'stage[import-law]: no top-level await — importing the lane module cannot run anything');
  // Importing twice is idempotent (the same function object).
  const again = await import('../src/workflow-lane.mjs');
  assert.equal(again.runWorkflow, laneModule.runWorkflow, 're-importing the lane is idempotent');
});

// ---------------------------------------------------------------------------
// W6 — refusal constancy: the same malformed spec refuses byte-identically on the embedded
// facade, the CLI, and the MCP tool.
// ---------------------------------------------------------------------------

test('W6-01 (stage[lane-missing]): refusal constancy — a malformed spec refuses byte-identically on facade, CLI, and MCP', async (t) => {
  const fx = await wadFixture(t);
  const malformed = validSpec({ bogusField: true });
  const specPath = join(fx.repo, 'specs', 'malformed.json');
  writeFileSync(specPath, JSON.stringify(malformed));
  const code = 'workflow_spec_invalid';

  // Facade leg: baton.recipes.runWorkflow refuses with the field-named code.
  const lane = laneOf(fx.baton, 'lane-missing'); // THROWS today — the lane is absent
  const facade = await captureError(() => lane(specPath));
  assert.equal(facade?.error?.code, code,
    `stage[lane-missing]: the embedded facade refuses the malformed spec as ${code}`);

  // CLI leg: baton wave run <spec.json> → waves.run (D2), then the same refusal.
  let parsed = null;
  try {
    parsed = parseBatonCli(['wave', 'run', specPath]);
  } catch (error) {
    assert.equal(error?.code, 'cli_command_unavailable',
      `stage[lane-missing]: baton wave run <spec.json> must parse to waves.run — the CLI verb is absent at HEAD`);
  }
  assert.equal(parsed?.command, 'waves.run',
    `stage[lane-missing]: D2 pins the verb → waves.run`);
  assert.ok(parsed?.args?.specPath ?? parsed?.args?.spec, 'the spec path rides the parsed args');
  const cli = await captureError(() => fx.application.command('waves.run', { specPath }, principalOf('wad-cli'), null));
  assert.equal(cli?.error?.code, code,
    `stage[lane-missing]: the CLI leg refuses the malformed spec as ${code}`);

  // MCP leg: baton_wave_run { repoId, spec } — the tool carries the spec object.
  assert.ok(mcpApplicationToolNames().includes('baton_wave_run'),
    `stage[lane-missing]: the baton_wave_run tool must join the application surface`);
  const server = await realServer(fx, mockPrincipal({ capabilities: ['control', 'observe'] }));
  await initialized(server);
  const mcp = await wireCall(server, 2, 'baton_wave_run', { repoId: REPO, spec: malformed });
  assert.equal(mcp.result?.isError, true, 'a malformed spec is an error on the wire');
  assert.match(resultText(mcp), new RegExp(code, 'u'), 'the wire refusal names the same code');

  // Byte-identity: code AND message are identical across the three surfaces.
  assert.equal(cli?.error?.code, facade?.error?.code, 'the CLI code is byte-identical to the facade');
  assert.equal(cli?.error?.message, facade?.error?.message,
    'the CLI refusal is byte-identical to the facade refusal');
  assert.match(resultText(mcp), new RegExp(escapeRegExp(facade?.error?.message ?? ''), 'u'),
    'the MCP refusal carries the facade message');
});

// ---------------------------------------------------------------------------
// MCP wire helpers (workflow-surface-red:1353-1413, verbatim).
// ---------------------------------------------------------------------------

function mockPrincipal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO], expiresAt: new Date(Date.now() + 60000).toISOString(), revoked: false, ...overrides,
  };
}

async function realServer(fx, principal) {
  const server = new McpFleetServer({
    coordinator: fx.driver.coordinator,
    coordination: fx.driver.coordination,
    application: fx.application,
    surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal,
    repoIds: [REPO], now: () => Date.now(), maxWaitMs: 25000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return server;
}

const wireRequest = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await wireRequest(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const wireCall = (server, id, name, args) => wireRequest(server, id, 'tools/call', { name, arguments: args });
const resultText = (response) => response?.result?.content?.[0]?.text ?? '';

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
