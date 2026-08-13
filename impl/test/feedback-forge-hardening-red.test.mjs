// #73 folded feedback-forge hardening — red-first acceptance suite.
// Authority: docs/reference/evidence/feedback-forge-hardening-2026-08-07/feedback-forge-hardening-contract.md
// (§5 pins, contract-fold.md B5/B6) via suite-73-brief.md.
//
// RED-FIRST: capability rows FAIL at NAMED stages at HEAD (R1–R6). PIN rows are GREEN at HEAD
// (P1–P7). The head split is recorded under "Verified split" below (stable across two runs).
//
// ROW INVENTORY (13 rows: 7 PIN / 6 RED at HEAD)
//   P1  GREEN-1  G2 shape boundary — gate-shaped {gate, detail} normalizes, then refuses on a
//               non-workflow run at the WORKFLOW gate with `application_workflow_feedback_unavailable`
//               (never the shape code). [DG-1b harness]
//   P2  G4-B1    The referent fix — `candidate.evidence.verification.worker` / `.workerSeq` are the
//               binding keys for the D1 hub-derived lookup (not the closed `verification` field).
//               [workflow harness]
//   P3  RED-2    Closed caller schema — `exactObject(value, ['gate', 'detail'])` refuses a
//               caller-authored `derived` key with `application_workflow_feedback_invalid`.
//               (GREEN at HEAD: the closed schema already exists.) [DG-1b harness]
//   P4  GREEN-5a run.debug failure leg — the honest referent a forged verdict spoofs projects the
//               exact `{kind, code, message, gate, detail:{digests, counts}}` shape. [DG-1b harness]
//   P5  GREEN-5b push constancy — the #79 `gate_verdict` push item carries NO `derived`; the D6
//               contract section and the push red-suite literal both stay derived-free (B6). [source scan]
//   P6  GREEN-3  Coaching feedback is authored and rendered exactly as today (summary + findings),
//               read back intact through the feedback section. [workflow harness]
//   P7          The refusal vocabulary (`application_workflow_feedback_invalid`,
//               `application_workflow_feedback_anchor_invalid`, `application_workflow_feedback_unavailable`,
//               `application_workflow_integrity`) is typed and surface-constant in application.mjs.
//               [source scan]
//   R1  RED-1    Forged verdict — caller-authored {gate, detail} with NO gate event on the Candidate
//               task stream refuses `application_workflow_feedback_gate_unbound` and appends nothing.
//               (RED at HEAD: the forge accepts and records it.) [workflow harness]
//   R2  GREEN-2  Validated-or-replaced — a byte-matching verdict with a REAL gate referent is recorded
//               `derived: true` with `gateEventSeq` bound to the source event's per-worker seq; a
//               fabricated verdict never lands with the caller's bytes. (RED at HEAD.) [workflow harness]
//   R3  GREEN-3  Coaching carries the derived flag — `derived: false` and `gateEventSeq: null` on
//               every coaching packet. (RED at HEAD: no flags exist.) [workflow harness]
//   R4  GREEN-4  Consumer safety — a gate-shaped verdict packet in the revision set must not crash
//               `workflow.select` / `workflow.revise` at `_workflowRevisionEligibility`
//               (`packet.feedback.findings.some`). (RED at HEAD: TypeError.) [workflow harness]
//   R5  B2       One derived-flag model — the `_workflowFeedback` projection uses a 12-field CLOSED
//               sorted-key literal including `derived` and `gateEventSeq`. (RED at HEAD: 10-field
//               literal at application.mjs:6360.) [source scan]
//   R6  B5       Per-record degradation + legacy migration — a pre-hardening shape-only gate-shaped
//               record is EXCLUDED from the read projection (itemCount 0), never a map-wide
//               `application_workflow_integrity` throw. (RED at HEAD: the forge's record surfaces.) [workflow]
//
// STAGES (named failure points on RED rows)
//   R1 expect_typed_refusal · R2 expect_derived_record (+ expect_replaced_record) ·
//   R3 expect_coaching_derived_false · R4 select_candidate_no_crash · R5 literal_12_field_closed ·
//   R6 expect_pre_hardening_record_excluded
//
// INVENTED SURFACES (namespace/string literals only — no invented imports)
//   - `application_workflow_feedback_gate_unbound`  (NEW refusal code; absent from application.mjs at HEAD)
//   - `derived` / `gateEventSeq` packet fields       (absent from the 10-field literal at HEAD)
//   - `wrapHubDerived` provenance discriminator      (B6; asserted only via the D6 push contract text)
//
// VERIFIED SPLIT (run `node --test impl/test/feedback-forge-hardening-red.test.mjs` TWICE from repo root)
//   Run 1: 7 passed / 6 failed   (P1–P7 green; R1–R6 red)   — stable
//   Run 2: 7 passed / 6 failed   (P1–P7 green; R1–R6 red)   — stable
//
// NUL DISCIPLINE: application.mjs contains literal NUL bytes (line 619 cacheKey); `grep` treats it
// as binary and fails silently. Manual inspection uses `grep -a` / `sed -n`. This suite reads
// sources with `readFileSync(..., 'utf8')` + string scanning, which is NUL-tolerant.
// NO CLOCKS AS CONTROLS: no wall-clock/timeout logic anywhere; workflow progress is driven by the
// resident openBaton dispatch loop, never by `setTimeout`.
// HERMETIC: every deployment is a `mkdtemp` repo + `mkdtemp` deployment root torn down by `t.after`;
// adapters are MockAdapter subclasses; verification is `command: 'true'`; no network, no real spawns.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, openBaton } from '../src/index.mjs';

const repoId = 'repo-feedback-forge-hardening';
const OBJECTIVE = 'Produce two attributable candidate improvements.';
const ROUTE_A = Object.freeze({ harness: 'codex', model: 'model-a', effort: 'high' });
const ROUTE_B = Object.freeze({ harness: 'grok', model: 'model-b', effort: 'medium' });

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

// The B2 12-field CLOSED packet literal in ACTUAL sorted-key order (suite law: no re-sorting).
const CLOSED_PACKET_FIELDS = Object.freeze([
  'definitionDigest', 'derived', 'feedback', 'feedbackId', 'gateEventSeq', 'planDigest',
  'prefix', 'repoId', 'runId', 'schemaVersion', 'source', 'target',
]);

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

function scopeGatePayload({
  digestA = DIGEST_A, digestB = DIGEST_B, digestC = DIGEST_C,
} = {}) {
  return {
    gate: 'scope',
    detail: {
      digests: {
        changedPathsDigest: digestA,
        inScopeChangedPathsDigest: digestB,
        outOfScopeChangedPathsDigest: digestC,
      },
      counts: { changedPathCount: 1, inScopeChangedPathCount: 0, outOfScopeChangedPathCount: 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// DG-1b harness (mirrors diagnostics-red.test.mjs) — for P1, P3, P4.
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `ffh-${label}-`));
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
        provenance: 'feedback-forge-hardening-red', refreshedAt: null,
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
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
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
  const run = await baton.runs.start('feedback forge fixture (marker:ffh)', {
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

const emit = (adapter, workerId, kind, payload) => adapter.emit({
  worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind, actor: 'worker', payload,
});

function emitScopeGateEvent(adapter, workerId) {
  emit(adapter, workerId, 'error', {
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
  });
}

// ---------------------------------------------------------------------------
// openBaton workflow harness (real resident dispatch loop) — for P2, P6, R1–R4, R6.
// ---------------------------------------------------------------------------

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'ffh-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'ffh@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'FFH'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

class EmittableAdapter extends MockAdapter {
  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function workflowAdapter(route, path) {
  const value = new EmittableAdapter({
    harness: route.harness,
    scenario: { outcome: 'completed', edits: [{ path, content: `${route.harness}\n`, delayMs: 0 }] },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'feedback-forge-hardening-red', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

async function openWorkflow(t) {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'ffh-deploy-'));
  const adapters = {
    codex: workflowAdapter(ROUTE_A, 'candidate-a.txt'),
    grok: workflowAdapter(ROUTE_B, 'candidate-b.txt'),
  };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [ROUTE_A, ROUTE_B],
      adapters,
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow(OBJECTIVE, {
    team: [
      { role: 'builder', exact: ROUTE_A },
      { role: 'challenger', exact: ROUTE_B },
    ],
  });
  await workflow.complete();
  return { deployment, workflow, adapters, deploymentRoot };
}

async function candidateFor(workflow, role) {
  const candidates = await workflow.candidates();
  return candidates.section?.items?.find((it) => it.value?.role === role)?.value ?? null;
}

function readWorkerGateSeq(deploymentRoot, workerId, runId, taskId) {
  const source = readFileSync(join(deploymentRoot, 'state', `${workerId}.jsonl`), 'utf8')
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const gate = source.find((event) => (
    event.kind === 'error'
    && event.payload?.code === 'worker_path_scope_violation'
    && event.runId === runId && event.taskId === taskId
  ));
  return gate?.seq ?? null;
}

// ---------------------------------------------------------------------------
// Source scans (P5, P7, R5) — NUL-tolerant readFileSync scanning.
// ---------------------------------------------------------------------------

function readWorkflowFeedbackFieldsLiteral() {
  const source = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  const methodAnchor = '  _workflowFeedback(current, definition, candidates) {';
  const methodStart = source.indexOf(methodAnchor);
  assert.notEqual(methodStart, -1, 'precondition: _workflowFeedback method exists');
  const fieldsAnchor = 'const fields = [';
  const fieldsStart = source.indexOf(fieldsAnchor, methodStart);
  assert.notEqual(fieldsStart, -1, 'precondition: a fields literal exists inside _workflowFeedback');
  const close = source.indexOf(']', fieldsStart + fieldsAnchor.length);
  const literal = source.slice(fieldsStart + fieldsAnchor.length, close);
  return [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

// ---------------------------------------------------------------------------
// PIN rows — green at HEAD.
// ---------------------------------------------------------------------------

test('P1 (PIN): G2 shape boundary — gate-shaped input passes normalization, refuses at the WORKFLOW gate', async (t) => {
  const { application, baton, adapter } = dg1Harness(t);
  const { workerId, runId } = await startRun(baton);

  emitScopeGateEvent(adapter, workerId);
  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0]?.failure;
  assert.equal(failure?.gate, 'scope', 'precondition: the debug failure leg projects the scope gate');

  // Gate-shaped {gate, detail} must be accepted by input normalization (never the shape code) and
  // refuse only at the workflow gate on a non-workflow run (GREEN-1 / G2 discriminator).
  const err = await application.command('run.feedback', {
    runId,
    role: 'work',
    feedback: { gate: failure.gate, detail: failure.detail },
  }, principal('observer')).then(() => null, (error) => error);
  assert.ok(err, 'run.feedback must not silently no-op on a non-workflow run');
  assert.equal(
    err.code,
    'application_workflow_feedback_unavailable',
    `gate-shaped input dispatches to the workflow gate, not a shape reject; got ${err.code}: ${err.message}`,
  );
});

test('P2 (PIN): referent fix (G4-B1) — evidence.verification.worker/workerSeq are the D1 binding keys', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder, 'precondition: verified candidate');

  const verification = builder.evidence?.verification;
  assert.ok(verification, 'precondition: candidate carries evidence.verification');
  assert.equal(typeof verification.worker, 'string', 'P2: worker binding is the verification.worker key');
  assert.ok(
    Number.isSafeInteger(verification.workerSeq) && verification.workerSeq > 0,
    `P2: workerSeq is the verify.reverified event seq; got ${verification.workerSeq}`,
  );
  assert.match(verification.verdictDigest, /^[a-f0-9]{64}$/u, 'P2: verdictDigest is hex64');
  assert.match(verification.changedPathsDigest, /^[a-f0-9]{64}$/u, 'P2: changedPathsDigest is hex64');

  // The hardened D1 lookup must resolve against the worker stream named by evidence.verification.worker.
  const debug = await workflow.debug();
  const member = debug.members?.find((m) => m.workerId === verification.worker);
  assert.ok(member, 'P2: evidence.verification.worker resolves to a real worker stream member');
});

test('P3 (PIN): RED-2 closed caller schema — a caller-authored derived flag is refused as invalid', async (t) => {
  const { application, baton } = dg1Harness(t);
  const { runId } = await startRun(baton);

  const err = await application.command('run.feedback', {
    runId,
    role: 'work',
    feedback: { ...scopeGatePayload(), derived: true },
  }, principal('observer')).then(() => null, (error) => error);
  assert.ok(err, 'a caller-supplied derived flag must be refused');
  assert.equal(
    err.code,
    'application_workflow_feedback_invalid',
    `derived is hub-set only — the closed {gate, detail} schema refuses a caller derived key; got ${err.code}`,
  );
});

test('P4 (PIN): GREEN-5a run.debug failure shape — the honest referent a forged verdict spoofs', async (t) => {
  const { application, baton, adapter } = dg1Harness(t);
  const { workerId, runId } = await startRun(baton);

  emitScopeGateEvent(adapter, workerId);
  const debug = await application.debug({ runId }, principal('observer'));
  assert.deepEqual(debug.members[0].failure, {
    kind: 'error',
    code: 'worker_path_scope_violation',
    message: 'scope',
    gate: 'scope',
    detail: {
      digests: {
        changedPathsDigest: DIGEST_A,
        inScopeChangedPathsDigest: DIGEST_B,
        outOfScopeChangedPathsDigest: DIGEST_C,
      },
      counts: { changedPathCount: 1, inScopeChangedPathCount: 0, outOfScopeChangedPathCount: 1 },
    },
  });
});

test('P5 (PIN): GREEN-5b push constancy — the #79 gate_verdict push item stays derived-free (B6)', () => {
  const contractPath = new URL(
    '../../docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md',
    import.meta.url,
  );
  const contract = readFileSync(contractPath, 'utf8');
  const d6Start = contract.indexOf('### D6');
  const refusalStart = contract.indexOf('## Refusal vocabulary', d6Start);
  assert.ok(d6Start !== -1 && refusalStart !== -1, 'precondition: the push contract carries a D6 section');
  const d6 = contract.slice(d6Start, refusalStart);
  assert.ok(d6.includes('gate:${event.seq}'), 'P5: the gate_verdict requestId is keyed gate:<source event seq>');
  assert.ok(!d6.includes('derived'), 'P5: the D6 push-item spec must not gain a derived field (B6)');

  // The push red suite pins the literal — it must keep carrying NO derived key.
  const suitePath = new URL('./worker-delivery-push-red.test.mjs', import.meta.url);
  const suite = readFileSync(suitePath, 'utf8');
  const itemLine = suite.split('\n').find((line) => line.includes("kind: 'gate_verdict'"));
  assert.ok(itemLine, 'precondition: the push red suite pins a gate_verdict item literal');
  assert.ok(!itemLine.includes('derived'), 'P5: the gate_verdict item literal carries no derived key (B6)');
});

test('P6 (PIN): GREEN-3 coaching feedback is authored and rendered exactly as today', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder, 'precondition: verified candidate');

  const coaching = {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable delta.',
      path: 'candidate-a.txt', line: 1,
    }],
  };
  await workflow.sendFeedback('builder', coaching);
  const fb = await workflow.feedback();
  const item = fb.section?.items?.find((it) => it.value?.target?.role === 'builder');
  assert.ok(item, 'P6: the coaching packet read back');
  assert.equal(item.summary, coaching.summary, 'P6: the feedback section renders the coaching summary');
  assert.equal(item.value.feedback?.summary, coaching.summary, 'P6: the packet carries the authored summary');
  assert.deepEqual(item.value.feedback?.findings, coaching.findings, 'P6: the packet carries the authored findings');
});

test('P7 (PIN): the contract refusal vocabulary is typed and surface-constant in application.mjs', () => {
  const source = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  for (const code of [
    'application_workflow_feedback_invalid',
    'application_workflow_feedback_anchor_invalid',
    'application_workflow_feedback_unavailable',
    'application_workflow_integrity',
  ]) {
    assert.ok(source.includes(code), `refusal code ${code} is typed in application.mjs`);
  }
});

// ---------------------------------------------------------------------------
// RED rows — fail at NAMED stages at HEAD.
// ---------------------------------------------------------------------------

test('R1 (RED): forged verdict with no gate referent refuses typed gate-unbound (stage: expect_typed_refusal)', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder?.evidence?.verification?.worker, 'precondition: verified candidate');

  // No gate event exists on this Candidate's task stream — the caller-authored bytes are a forge.
  const outcome = await workflow.sendFeedback('builder', scopeGatePayload()).then(
    (value) => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  assert.equal(
    outcome.ok,
    false,
    'a caller-authored {gate, detail} with no gate event on the Candidate task stream must refuse '
    + 'at stage: expect_typed_refusal',
  );
  assert.equal(
    outcome.code,
    'application_workflow_feedback_gate_unbound',
    `refusal must be the typed gate-unbound code; got ${outcome.code}`,
  );

  // The refusal must be durable — no record appended.
  const fb = await workflow.feedback();
  assert.equal(fb.section?.itemCount ?? 0, 0, 'the refusal must append no record');
});

test('R2 (RED): validated-or-replaced — a verdict with a REAL gate referent is derived:true, seq-bound (stage: expect_derived_record)', async (t) => {
  const { workflow, adapters, deploymentRoot } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  const workerId = builder?.evidence?.verification?.worker;
  const taskId = builder?.taskId;
  assert.ok(workerId && taskId, 'precondition: verified candidate');

  // stage: emit_real_gate_event — a real scope-gate failure on the candidate's worker stream.
  emitScopeGateEvent(adapters.codex, workerId);
  const gateSeq = readWorkerGateSeq(deploymentRoot, workerId, workflow.id, taskId);
  assert.ok(
    Number.isSafeInteger(gateSeq) && gateSeq > 0,
    `precondition: the gate event is durable with a seq; got ${gateSeq}`,
  );

  // stage: referent_visible — the debug failure leg projects the same {gate, detail} the forge spoofs.
  const debug = await workflow.debug();
  const member = debug.members?.find((m) => m.workerId === workerId);
  const referent = { gate: member?.failure?.gate, detail: member?.failure?.detail };
  assert.equal(referent.gate, 'scope', 'precondition: the referent gate is scope');

  // stage: submit_matching — the byte-matching {gate, detail} is accepted.
  const matching = { gate: referent.gate, detail: referent.detail };
  await workflow.sendFeedback('builder', matching).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );

  // stage: expect_derived_record — the stored packet is the DERIVED verdict with derived:true and
  // gateEventSeq bound to the source event's per-worker seq.
  const fb = await workflow.feedback();
  const packet = fb.section?.items?.find((it) => it.value?.target?.role === 'builder')?.value;
  assert.ok(packet, 'precondition: the verdict packet read back');
  assert.equal(
    packet.derived,
    true,
    'stage: expect_derived_record — derived must be hub-set true on the verdict packet',
  );
  assert.equal(
    packet.gateEventSeq,
    gateSeq,
    'stage: expect_derived_record — gateEventSeq must bind the source gate event seq',
  );
  assert.deepEqual(packet.feedback, referent, 'the stored feedback is the derived {gate, detail}');

  // stage: submit_mismatched — a fabricated verdict is accepted-but-replaced (or refused), never
  // persisted with the caller's bytes.
  await workflow.sendFeedback('builder', { gate: 'red_green', detail: { tail: 'x' } }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  const after = await workflow.feedback();
  const gatePackets = (after.section?.items ?? [])
    .map((it) => it.value)
    .filter((value) => value?.feedback && value.feedback.gate !== undefined);
  for (const value of gatePackets) {
    // stage: expect_replaced_record — no packet carries the fabricated red_green bytes.
    assert.equal(value.feedback.gate, 'scope', 'stage: expect_replaced_record — a fabricated verdict is replaced by the derived gate');
    assert.equal(value.derived, true, 'stage: expect_replaced_record — replacement carries derived:true');
    assert.equal(value.gateEventSeq, gateSeq, 'stage: expect_replaced_record — replacement binds the same source seq');
  }
});

test('R3 (RED): coaching feedback is recorded derived:false / gateEventSeq:null (stage: expect_coaching_derived_false)', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder, 'precondition: verified candidate');

  await workflow.sendFeedback('builder', {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable delta.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const fb = await workflow.feedback();
  const packet = fb.section?.items?.find((it) => it.value?.target?.role === 'builder')?.value;
  assert.ok(packet, 'precondition: the coaching packet read back');

  // PIN: coaching shape is authored and read back intact (GREEN-3 unchanged).
  assert.equal(packet.feedback?.summary, 'Keep the candidate but document the changed path before synthesis.');
  assert.equal(packet.feedback?.findings?.[0]?.kind, 'suggestion');

  // RED: the one derived-flag model marks coaching derived:false / gateEventSeq:null (B2).
  assert.equal(
    packet.derived,
    false,
    'stage: expect_coaching_derived_false — coaching must carry derived:false',
  );
  assert.equal(
    packet.gateEventSeq,
    null,
    'stage: expect_coaching_derived_false — coaching must carry gateEventSeq:null',
  );
});

test('R4 (RED): consumer safety — a verdict packet in the revision set must not crash select/revise (stage: select_candidate_no_crash)', async (t) => {
  const { workflow, adapters } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  const workerId = builder?.evidence?.verification?.worker;
  assert.ok(workerId, 'precondition: verified candidate');

  // A REAL gate referent so the hardened admission can produce a legitimate derived verdict.
  emitScopeGateEvent(adapters.codex, workerId);
  await workflow.sendFeedback('builder', scopeGatePayload()).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );

  // RED: _workflowRevisionEligibility must not crash on the gate-shaped packet
  // (packet.feedback.findings.some on undefined).
  const selected = await workflow.select('builder', 'The builder Candidate is the preferred verified basis.').then(
    (value) => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  assert.equal(
    selected.ok,
    true,
    `select must not crash on a gate-shaped verdict packet at stage: select_candidate_no_crash; got ${selected.message ?? ''}`,
  );

  // Unreachable at HEAD (select crashes first) — revise must also stay crash-free after hardening.
  const revised = await workflow.revise('Revise the builder candidate.').then(
    (value) => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  assert.equal(revised.ok, true, 'revise must not crash on a gate-shaped verdict packet');
});

test('R5 (RED): B2 one derived-flag model — the projection literal is the 12-field closed set (stage: literal_12_field_closed)', () => {
  const fields = readWorkflowFeedbackFieldsLiteral();
  assert.deepEqual(
    fields,
    CLOSED_PACKET_FIELDS,
    'stage: literal_12_field_closed — _workflowFeedback must project the 12-field closed sorted-key '
    + `literal; got ${JSON.stringify(fields)}`,
  );
});

test('R6 (RED): B5 per-record degradation — a pre-hardening gate-shaped record is excluded, never a map-wide throw (stage: expect_pre_hardening_record_excluded)', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder?.evidence?.verification?.worker, 'precondition: verified candidate');

  // Pre-hardening record: a shape-only gate-shaped packet with NO referent event. At HEAD the forge
  // records it (the pre-hardening population); the hardened admission refuses it (RED-1) — either
  // way no honest record may surface in the read.
  await workflow.sendFeedback('builder', scopeGatePayload()).then(
    () => ({ accepted: true }),
    (error) => ({ accepted: false, code: error?.code, message: error?.message }),
  );

  // PIN (B5 part 1): reading feedback never throws a map-wide application_workflow_integrity.
  const fb = await workflow.feedback();

  // RED (B5 part 2): the pre-hardening shape-only record is EXCLUDED per-record from the read.
  assert.equal(
    fb.section?.itemCount ?? 0,
    0,
    'a pre-hardening shape-only gate-shaped record must be excluded per-record (B5) at stage: '
    + `expect_pre_hardening_record_excluded; got ${fb.section?.itemCount ?? 0} packet(s)`,
  );
});
