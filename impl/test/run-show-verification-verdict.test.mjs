// Run-show verification verdict (issue #334): `baton run show RUN_ID` at the default
// (outline) depth carries the worker-verdict-surface projection beside retry_verification
// for a failed or inconclusive verification, with the bounded sanitized failure tail.
//
// Motivating case: a run whose referee recorded outcome inconclusive / failureOwnership
// baseline_or_environment / diagnosticCode verification_exit_mismatch read only "failed"
// on run show. The outline must name WHAT was checked (check), the corrective class
// (corrective, honest null when the code carries none), and the referee's failureCapsule
// as a bounded sanitized tail — the same hub-minted table the worker surface uses.
//
// Row inventory (7 rows — all GREEN at landing; red-before during development):
//   V1  pure #334 triple (inconclusive/baseline_or_environment/verification_exit_mismatch)
//   V2  pure failed red_green with an adversarial capsule (sanitizer reused verbatim)
//   V3  pure bounded tail (over-bound capsule text stays within the capsule bound)
//   V4  pure honest absence (passed/pending states and missing verdict project null;
//       an unmappable code escalates check/corrective to null)
//   V5  e2e inconclusive run: outline.verification rides beside retry_verification
//   V6  e2e outline.verification never leaks paths or the checkpoint ref
//   V7  e2e failed candidate run still carries its own corrective (failing_check_fix)
//
// Suite-law hygiene: hermetic (real createDriver stack, MockAdapter, broken/corrected
// verifier runtimes — no harness, no network, no real provider spawns; mkdtemp repos/logs;
// test.after cleanup); no clocks as controls (bounded poll for the terminal phase only).

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BatonApplication,
  MockAdapter,
  createDriver,
} from '../src/index.mjs';
import * as applicationNs from '../src/application.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

// ---------------------------------------------------------------------------
// Pure projection rows (V1-V4)
// ---------------------------------------------------------------------------

test('V1: the #334 triple projects gate unknown, the closed code as check, and honest-null corrective', () => {
  assert.equal(typeof applicationNs.projectRunVerdictSurface, 'function',
    'stage: run-verdict-missing — projectRunVerdictSurface(verification) is the run-show projection');
  const surface = applicationNs.projectRunVerdictSurface({
    state: 'inconclusive',
    verdict: {
      outcome: 'inconclusive',
      failureOwnership: 'baseline_or_environment',
      diagnosticCode: 'verification_exit_mismatch',
      failureCapsule: { text: 'candidate exited 3, baseline exited 3' },
    },
  });
  assert.ok(surface, 'a failed/inconclusive verification projects a run verdict');
  assert.equal(surface.state, 'inconclusive', 'the verification state rides the record');
  assert.equal(surface.outcome, 'inconclusive', 'the referee outcome rides the record');
  assert.equal(surface.failureOwnership, 'baseline_or_environment', 'ownership names the baseline, never the route');
  assert.equal(surface.diagnosticCode, 'verification_exit_mismatch', 'the closed diagnosticCode rides the record');
  assert.equal(surface.gate, 'unknown', 'exit_mismatch is not a mapped gate');
  assert.equal(surface.code, 'verification_exit_mismatch', 'the terminal code rides the record');
  assert.equal(surface.check, 'verification_exit_mismatch', 'WHAT was checked — the closed code itself');
  assert.deepEqual(surface.detail, {}, 'no evidence class for the unknown gate');
  assert.equal(surface.corrective, null, 'honest absence — escalate, never an invented corrective');
  assert.ok(typeof surface.failureTail === 'string' && surface.failureTail.includes('exited 3'),
    'the referee failureCapsule rides as the bounded sanitized tail');
});

test('V2: a failed red_green verification sanitizes the adversarial capsule through the one sanitizer', () => {
  assert.equal(typeof applicationNs.projectRunVerdictSurface, 'function', 'stage: run-verdict-missing');
  const secret = 'trace at /Users/alice/projects/secret/lib.rs:12 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-here';
  const surface = applicationNs.projectRunVerdictSurface({
    state: 'failed',
    verdict: {
      outcome: 'candidate_failed',
      failureOwnership: 'candidate',
      diagnosticCode: 'verification_red_green_failed',
      failureCapsule: { text: secret },
    },
  });
  assert.ok(surface, 'a failed verification projects a run verdict');
  assert.equal(surface.gate, 'red_green', 'WHICH gate the referee checked');
  assert.equal(surface.check, 'verification_red_green_failed', 'the closed diagnosticCode names WHAT was checked');
  assert.equal(surface.corrective, 'failing_check_fix', 'the corrective is keyed by the terminal code');
  assert.ok(!String(surface.failureTail).includes('/Users/alice'), 'the adversarial home path never crosses');
  assert.ok(!JSON.stringify(surface).includes('eyJhbGciOiJIUzI1NiJ9'), 'the adversarial JWT never crosses');
  assert.equal(surface.detail?.tail, surface.failureTail, 'detail.tail is the same sanitizer output — no parallel redaction path');
});

test('V3: an over-bound capsule tail stays within the verifier failure-tail byte bound', () => {
  assert.equal(typeof applicationNs.projectRunVerdictSurface, 'function', 'stage: run-verdict-missing');
  const surface = applicationNs.projectRunVerdictSurface({
    state: 'failed',
    verdict: {
      outcome: 'candidate_failed',
      failureOwnership: 'candidate',
      diagnosticCode: 'verification_coverage_failed',
      failureCapsule: { text: `line\n`.repeat(20_000) },
    },
  });
  assert.ok(surface, 'a failed verification projects a run verdict');
  assert.equal(surface.gate, 'coverage', 'WHICH gate the referee checked');
  assert.equal(surface.corrective, 'coverage_completion', 'the corrective is keyed by the terminal code');
  assert.ok(Buffer.byteLength(surface.failureTail, 'utf8') <= 8_192,
    'the tail is bounded by the referee capsule bound (MAX_VERIFIER_FAILURE_TAIL_BYTES)');
});

test('V4: settled or unverified runs project null; an unmappable code escalates check/corrective to null', () => {
  assert.equal(typeof applicationNs.projectRunVerdictSurface, 'function', 'stage: run-verdict-missing');
  assert.equal(applicationNs.projectRunVerdictSurface({
    state: 'mechanically_verified',
    verdict: { outcome: 'passed', failureOwnership: null, diagnosticCode: 'verification_passed' },
  }), null, 'a verified run carries no failure verdict on run show');
  assert.equal(applicationNs.projectRunVerdictSurface({ state: 'pending', verdict: null }), null,
    'a run with no verdict yet projects null — recorded absence, never a fabricated surface');
  assert.equal(applicationNs.projectRunVerdictSurface(null), null, 'a missing verification block projects null');
  const escalated = applicationNs.projectRunVerdictSurface({
    state: 'failed',
    verdict: { outcome: 'candidate_failed', failureOwnership: 'candidate', diagnosticCode: 'not_a_closed_code' },
  });
  assert.ok(escalated, 'a failed verification still projects a record');
  assert.equal(escalated.gate, 'unknown', 'an unmappable code degrades to the honest unknown gate');
  assert.equal(escalated.check, null, 'an unmappable code never names WHAT was checked');
  assert.equal(escalated.corrective, null, 'an unmappable code carries no corrective');
});

// ---------------------------------------------------------------------------
// End-to-end rows (V5-V7) — a real run driven to failed verification, read back
// through run.inspect at outline depth (what `baton run show RUN_ID` serves).
// ---------------------------------------------------------------------------

const repoId = 'repo-run-show-verdict';

function gitRepo(name) {
  const repo = mkdtempSync(join(tmpdir(), `baton-rsv-${name}-repo-`));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'run-show-verdict@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Run Show Verdict'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function policy() {
  return Object.freeze({
    schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
    riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
    capabilityClasses: ['code', 'test'],
    limits: Object.freeze({
      maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
      maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
      maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 262 * 1024,
      maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
    }),
  });
}

function profile(verificationContract) {
  return {
    schemaVersion: 1, repoId,
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'low',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['**'],
    verification: verificationContract,
    routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    followPolicy: { mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16, maxResponseBytes: 64 * 1024, maxScanEvents: 128 },
  };
}

function verificationContract() {
  return {
    command: 'node', arguments: ['-e', 'process.exit(0)'], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  };
}

function adapter() {
  const instance = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 0, summary: 'run-show verdict candidate produced',
      edits: [{ path: 'candidate.txt', content: 'candidate\n' }],
    },
  });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return instance;
}

function fixture(name, runtimePolicy, contract = verificationContract()) {
  const repo = gitRepo(name);
  const logDir = mkdtempSync(join(tmpdir(), `baton-rsv-${name}-log-`));
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
    adapters: { mock: adapter() },
    goalPlanAuthority: { policy: policy(), authorize: async () => true },
    verificationRuntime: runtimePolicy,
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: { showable: profile(contract) },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { application, driver, repo, logDir };
}

// An existing, deployment-shaped bin directory that simply lacks `node`: the pinned
// command spawn is `unavailable` — the inconclusive lever (phase69 VR6 precedent).
function brokenRuntimePolicy() {
  return { schemaVersion: 1, pathEntries: [mkdtempSync(join(tmpdir(), 'baton-rsv-empty-bin-'))], constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } };
}

async function inspectOutline(application, runId) {
  return application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
}

async function driveToFailed(context, runId) {
  await context.application.command('run.start', {
    intent: {
      runId,
      objective: 'Prove the run-show verification verdict on a failed verification',
      profile: 'showable',
      route: { harness: 'mock', model: 'model-a', effort: 'low' },
      scope: ['**'],
    },
  }, principal('owner'));
  let outline = await inspectOutline(context.application, runId);
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  assert.ok(approve, 'the fresh run offers plan approval');
  await context.application.command('run.act', { runId, actionId: approve.actionId, inputs: {} }, principal('owner'));
  for (let attempt = 0; attempt < 600; attempt += 1) {
    outline = await inspectOutline(context.application, runId);
    // 'inconclusive' is terminal too (#334): a verification the base shares rests there with no
    // accepted result, so the driver waits it out like a failed run.
    if (['failed', 'inconclusive', 'work_completed', 'completed'].includes(outline.outline.phase)) break;
    await sleep(10);
  }
  assert.ok(['failed', 'inconclusive'].includes(outline.outline.phase), JSON.stringify(outline.outline.progress));
  return outline;
}

test('V5: an inconclusive run outline carries the verdict projection beside retry_verification', async (t) => {
  const f = fixture('inconclusive', brokenRuntimePolicy());
  t.after(async () => {
    try { await f.application.shutdown(principal('cleanup')); }
    catch { try { await f.driver.drainAndClose('run-show-verdict-cleanup'); } catch { /* teardown */ } }
  });
  const runId = 'run-show-verdict-inconclusive';
  const outline = await driveToFailed(f, runId);

  const verification = outline.outline.verification;
  assert.ok(verification, 'stage: run-verdict-missing — the outline carries the verification verdict block');
  assert.equal(verification.state, 'inconclusive', 'the inconclusive state reads as inconclusive, never bare failed');
  assert.equal(typeof verification.diagnosticCode, 'string', 'the closed diagnosticCode is named');
  assert.equal(verification.check, verification.diagnosticCode, 'WHAT was checked — the closed code itself');
  assert.ok('corrective' in verification, 'the corrective class rides the outline (honest null where the table has none)');
  assert.ok('gate' in verification && 'code' in verification && 'detail' in verification,
    'the shared {gate, code, check, detail, corrective} projection rides run show');

  const kinds = outline.outline.actions.map((action) => action.kind);
  assert.ok(kinds.includes('retry_verification'), `the verdict rides BESIDE retry_verification (actions: ${kinds.join(',')})`);
});

test('V6: the outline verdict never leaks paths or the checkpoint ref', async (t) => {
  const f = fixture('leak', brokenRuntimePolicy());
  t.after(async () => {
    try { await f.application.shutdown(principal('cleanup')); }
    catch { try { await f.driver.drainAndClose('run-show-verdict-cleanup'); } catch { /* teardown */ } }
  });
  const outline = await driveToFailed(f, 'run-show-verdict-leak');
  const rendered = JSON.stringify(outline.outline.verification);
  assert.equal(rendered.includes('refs/baton/checkpoints'), false, 'no checkpoint git ref in the verdict block');
  assert.equal(rendered.includes(f.repo), false, 'no repository path in the verdict block');
  assert.equal(rendered.includes('/tmp/'), false, 'no sandbox path in the verdict block');
});
test('V7: an exit mismatch the base shares reads as its own closed code with the baseline named the owner', async (t) => {
  // The pinned command fails everywhere (exit 3 against expectExit 0) and the candidate's tree
  // carries no change, so the base fails the same contract: the referee refuses to blame the
  // candidate and rests the run inconclusive (referee.mjs — candidate ownership requires a base
  // that passes the same check).
  const binDir = mkdtempSync(join(tmpdir(), 'baton-rsv-fixed-bin-'));
  symlinkSync(process.execPath, join(binDir, 'node'));
  const contract = {
    ...verificationContract(),
    arguments: ['-e', 'process.exit(3)'],
  };
  const f = fixture('candidate', {
    schemaVersion: 1, pathEntries: [binDir], constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  }, contract);
  t.after(async () => {
    try { await f.application.shutdown(principal('cleanup')); }
    catch { try { await f.driver.drainAndClose('run-show-verdict-cleanup'); } catch { /* teardown */ } }
  });
  const outline = await driveToFailed(f, 'run-show-verdict-candidate');
  const verification = outline.outline.verification;
  assert.equal(verification.diagnosticCode, 'verification_claim_diverged', 'the referee names the closed claim-divergence code');
  assert.equal(verification.gate, 'unknown', 'a non-gate diagnostic degrades to the honest unknown gate');
  assert.equal(verification.check, verification.diagnosticCode, 'WHAT was checked — the closed code itself');
  assert.equal(verification.corrective, null, 'a null-table code carries honest-null corrective (escalate)');
  assert.equal(verification.outcome, 'inconclusive', 'the shared failure reads inconclusive, never a bare failed string');
  assert.equal(verification.failureOwnership, 'baseline_or_environment', 'the base that fails the same check owns the failure');
});
