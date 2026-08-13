// #73 folded feedback-forge hardening — red-first acceptance suite.
// Authority: docs/reference/evidence/feedback-forge-hardening-2026-08-07/feedback-forge-hardening-contract.md
// (§5 pins, contract-fold.md B5/B6) via suite-73-brief.md.
//
// RED-FIRST: capability rows FAIL at NAMED stages at HEAD (R1–R8). PIN rows are GREEN at HEAD
// (P1–P8). The head split is recorded under "Verified split" below (stable across two runs).
//
// ROW INVENTORY (16 rows: 8 PIN / 8 RED at HEAD)
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
//   P8  S2       Coaching-branch SECRET_SHAPED_TEXT guard — a secret-shaped coaching `summary` or
//               finding `message` through `workflow.sendFeedback` refuses
//               `application_workflow_feedback_invalid` and appends nothing. (GREEN at HEAD: the
//               guard already exists at application.mjs:1665/:1675.) [workflow harness]
//   R1  RED-1    Forged verdict — caller-authored {gate, detail} with NO gate event on the Candidate
//               task stream refuses `application_workflow_feedback_gate_unbound` and appends nothing.
//               (RED at HEAD: the forge accepts and records it.) [workflow harness]
//   R2  GREEN-2  Validated-or-replaced + B4 replay-stability — a byte-matching verdict with a REAL
//               gate referent is recorded `derived: true` with `gateEventSeq` bound to the source
//               event's per-worker seq; a fabricated verdict never lands with the caller's bytes;
//               a SECOND gate event after recording must NOT move the bound projection. (RED at
//               HEAD.) [workflow harness]
//   R3  GREEN-3  Coaching carries the derived flag — `derived: false` and `gateEventSeq: null` on
//               every coaching packet. (RED at HEAD: no flags exist.) [workflow harness]
//   R4  GREEN-4  Consumer safety + render half — a gate-shaped verdict packet in the revision set
//               must not crash `workflow.select` / `workflow.revise` at `_workflowRevisionEligibility`
//               (`packet.feedback.findings.some`), the feedback section renders a non-`undefined`
//               verdict summary, and the revision objective carries a distinct verdict line (never
//               `Feedback: undefined`). (RED at HEAD: TypeError.) [workflow harness]
//   R5  B2       One derived-flag model — the `_workflowFeedback` projection uses a 12-field CLOSED
//               sorted-key literal including `derived` and `gateEventSeq`. (RED at HEAD: 10-field
//               literal at application.mjs:6360.) [source scan]
//   R6  B5       Per-record degradation + legacy migration — a PERSISTED pre-hardening 10-field
//               gate-shaped record (staged directly through `driver.coordination.recordDriver`) is
//               EXCLUDED per-record from the read projection while a later coaching record still
//               projects; never a map-wide `application_workflow_integrity` throw. (RED at HEAD:
//               the staged record surfaces.) [workflow harness]
//   R7  S1       Candidate-scoped referent boundary — a gate event on workflow-1's builder worker
//               must NOT bind a gate-shaped submission for workflow-2's builder (a different run,
//               different worker, no gate event on its own task stream): the submission refuses
//               `application_workflow_feedback_gate_unbound` and appends nothing. (RED at HEAD: the
//               forge accepts — cross-run laundering unobserved.) [workflow harness]
//   R8  M3       D4 surface constancy — `application_workflow_feedback_gate_unbound` is typed in
//               application.mjs AND preserved verbatim through the web-northbound `application_*`
//               fallthrough and the mcp-northbound error mapper. (RED at HEAD: the code is absent
//               from every surface.) [source scan]
//
// STAGES (named failure points on RED rows)
//   R1 expect_typed_refusal · R2 expect_derived_record (+ expect_replaced_record,
//   expect_replay_stable) · R3 expect_coaching_derived_false · R4 select_candidate_no_crash
//   (+ expect_render_verdict_summary, expect_render_verdict_line) · R5 literal_12_field_closed ·
//   R6 expect_pre_hardening_record_excluded · R7 expect_second_run_refused ·
//   R8 expect_gate_unbound_typed
//
// INVENTED SURFACES (namespace/string literals only — no invented imports)
//   - `application_workflow_feedback_gate_unbound`  (NEW refusal code; absent from application.mjs at HEAD)
//   - `derived` / `gateEventSeq` packet fields       (absent from the 10-field literal at HEAD)
//   - `wrapHubDerived` provenance discriminator      (B6; asserted only via the D6 push contract text)
//
// VERIFIED SPLIT (run `node --test impl/test/feedback-forge-hardening-red.test.mjs` TWICE from repo root)
//   Run 1: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)   — stable
//   Run 2: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)   — stable
//
// NUL DISCIPLINE: application.mjs contains literal NUL bytes (line 619 cacheKey); `grep` treats it
// as binary and fails silently. Manual inspection uses `grep -a` / `sed -n`. This suite reads
// sources with `readFileSync(..., 'utf8')` + string scanning, which is NUL-tolerant.
// NO CLOCKS AS CONTROLS: no wall-clock/timeout logic anywhere; workflow progress is driven by the
// resident openBaton dispatch loop, never by `setTimeout`.
// HERMETIC: every deployment is a `mkdtemp` repo + `mkdtemp` deployment root torn down by `t.after`;
// adapters are MockAdapter subclasses; verification is `command: 'true'`; no network, no real spawns.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { bindBaton, createDriver, openBaton } from '../src/index.mjs';

const repoId = 'repo-feedback-forge-hardening';
const OBJECTIVE = 'Produce two attributable candidate improvements.';
const OBJECTIVE_2 = 'Produce a second distinct candidate set for the follow-up run.';
const ROUTE_A = Object.freeze({ harness: 'codex', model: 'model-a', effort: 'high' });
const ROUTE_B = Object.freeze({ harness: 'grok', model: 'model-b', effort: 'medium' });

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const DIGEST_E = 'e'.repeat(64);
const DIGEST_F = 'f'.repeat(64);

// The pre-hardening feedback record kind recorded by `sendWorkflowFeedback` at HEAD.
const APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND = 'application.workflow_feedback_recorded';

// Local replication of the internal canonical-digest (sha256 over JSON.stringify of a
// canonical-sorted value). Not exported from application.mjs — replicated here for the M1
// pre-hardening record construction recipe.
const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

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

function emitScopeGateEvent(adapter, workerId, {
  digestA = DIGEST_A, digestB = DIGEST_B, digestC = DIGEST_C,
} = {}) {
  emit(adapter, workerId, 'error', {
    message: 'scope',
    code: 'worker_path_scope_violation',
    phase: 'trust_gate',
    trustPhase: 'path_scope',
    pathScopeEvidence: {
      changedPathCount: 1,
      changedPathsDigest: digestA,
      inScopeChangedPathCount: 0,
      inScopeChangedPathsDigest: digestB,
      outOfScopeChangedPathCount: 1,
      outOfScopeChangedPathsDigest: digestC,
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

async function openWorkflow(t, { captureDriver = false } = {}) {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'ffh-deploy-'));
  const adapters = {
    codex: workflowAdapter(ROUTE_A, 'candidate-a.txt'),
    grok: workflowAdapter(ROUTE_B, 'candidate-b.txt'),
  };
  const options = {
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
  };
  let deployment;
  let capturedDriver = null;
  t.after(async () => {
    try { await deployment?.close(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  // R6 (M1) needs the driver to stage a genuine pre-hardening record through
  // `driver.coordination.recordDriver`. The M1 seam: openBatonDeployment accepts the driver
  // factory as param 2, so a wrapper captures the driver WITHOUT touching the private `#driver`
  // field, while the deployment still runs its resident dispatch loop.
  if (captureDriver) {
    deployment = await openBatonDeployment(options, (driverOpts) => {
      const driver = createDriver(driverOpts);
      capturedDriver = driver;
      return driver;
    });
  } else {
    deployment = await openBaton(options);
  }
  const workflow = await deployment.workflow(OBJECTIVE, {
    team: [
      { role: 'builder', exact: ROUTE_A },
      { role: 'challenger', exact: ROUTE_B },
    ],
  });
  await workflow.complete();
  return { deployment, workflow, adapters, deploymentRoot, driver: capturedDriver };
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

// M2 (B4 replay-stability): read ALL gate-event seqs on the candidate's worker stream for the run,
// in durable order — the second gate event after recording must not move the bound projection.
function readWorkerGateSeqs(deploymentRoot, workerId, runId, taskId) {
  const source = readFileSync(join(deploymentRoot, 'state', `${workerId}.jsonl`), 'utf8')
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return source
    .filter((event) => (
      event.kind === 'error'
      && event.payload?.code === 'worker_path_scope_violation'
      && event.runId === runId && event.taskId === taskId
    ))
    .map((event) => event.seq)
    .sort((a, b) => a - b);
}

// M1 (B5 legacy migration): stage a GENUINE pre-hardening feedback record through
// `driver.coordination.recordDriver` — the exact 10-field shape `sendWorkflowFeedback` records at
// HEAD (application.mjs:6785-6790). The pre-hardening population is persisted state, not a
// caller-authored forge: hardening must degrade it PER-RECORD on read-back, never throw map-wide.
async function stagePreHardeningRecord(driver, workflow, builder, feedback) {
  const goalEvent = driver.coordination.events()
    .find((event) => event.kind === 'goal.version_defined');
  const goalDigest = goalEvent?.payload?.goal?.digest;
  assert.ok(goalDigest, 'precondition: goal.version_defined carries the goal digest');

  const source = {
    kind: 'authenticated_user', actor: 'test', principalId: 'test-m1', sessionId: 'test-m1-session',
  };
  const target = {
    kind: 'candidate', role: builder.role, candidateId: builder.candidateId,
    candidateDigest: builder.candidateDigest, nodeKey: builder.nodeKey,
    taskId: builder.taskId, resultSha: builder.resultSha,
    changedPaths: [...builder.changedPaths],
    changedPathsDigest: digest(builder.changedPaths),
    retainedResultRef: builder.retainedResultRef,
    treeIdentityDigest: digest({
      resultSha: builder.resultSha, retainedResultRef: builder.retainedResultRef,
    }),
  };
  const feedbackId = `feedback:${digest({
    repoId: builder.repoId, runId: workflow.id, planDigest: builder.planDigest,
    definitionDigest: builder.definitionDigest, source, target, feedback,
  })}`;
  const throughSeq = driver.coordination.snapshot().lastSeq;
  const core = {
    schemaVersion: 1, repoId: builder.repoId, runId: workflow.id,
    planDigest: builder.planDigest, definitionDigest: builder.definitionDigest,
    feedbackId, source, target, feedback,
    prefix: {
      throughSeq, goalDigest, planDigest: builder.planDigest,
      definitionDigest: builder.definitionDigest,
    },
  };
  const recorded = driver.coordination.recordDriver(APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND, {
    ...core, feedbackDigest: digest(core),
  }, {
    actor: 'test',
    key: `${APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND}:${feedbackId}`,
  });
  assert.ok(
    Number.isSafeInteger(recorded?.event?.seq) && throughSeq < recorded.event.seq,
    `precondition: the staged record lands at a later seq than its prefix throughSeq; `
    + `throughSeq=${throughSeq} seq=${recorded?.event?.seq}`,
  );
  return recorded.event.seq;
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

test('P8 (PIN): S2 — the coaching branch refuses secret-shaped summary/message (application_workflow_feedback_invalid)', async (t) => {
  const { workflow } = await openWorkflow(t);
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder, 'precondition: verified candidate');

  // The SECRET_SHAPED_TEXT guard (application.mjs:1665 summary / :1675 message) already refuses
  // secret-looking coaching content at HEAD — GREEN, so this row is a PIN.
  const secret = 'sk-proj-' + 'A'.repeat(16);

  // Arm 1 — secret-shaped SUMMARY.
  const summaryOutcome = await workflow.sendFeedback('builder', {
    summary: `Keep the candidate, key=${secret}`,
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable delta.',
      path: 'candidate-a.txt', line: 1,
    }],
  }).then((value) => ({ ok: true }), (error) => ({ ok: false, code: error?.code }));
  assert.equal(
    summaryOutcome.ok,
    false,
    'P8: a secret-shaped coaching summary must refuse at application_workflow_feedback_invalid',
  );
  assert.equal(summaryOutcome.code, 'application_workflow_feedback_invalid', 'P8: summary arm refuses invalid');

  // Arm 2 — secret-shaped finding MESSAGE.
  const messageOutcome = await workflow.sendFeedback('builder', {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: `Use the token ${secret} when resuming.`,
      path: 'candidate-a.txt', line: 1,
    }],
  }).then((value) => ({ ok: true }), (error) => ({ ok: false, code: error?.code }));
  assert.equal(
    messageOutcome.ok,
    false,
    'P8: a secret-shaped finding message must refuse at application_workflow_feedback_invalid',
  );
  assert.equal(messageOutcome.code, 'application_workflow_feedback_invalid', 'P8: message arm refuses invalid');

  // Neither refusal appends a record.
  const fb = await workflow.feedback();
  assert.equal(fb.section?.itemCount ?? 0, 0, 'P8: the refusals append no record');
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

  // stage: second_gate_event — M2 (B4 replay-stability). A SECOND scope-gate event lands on the
  // same worker stream with DIFFERENT digests after the verdict was recorded.
  emitScopeGateEvent(adapters.codex, workerId, {
    digestA: DIGEST_D, digestB: DIGEST_E, digestC: DIGEST_F,
  });
  const gateSeqs = readWorkerGateSeqs(deploymentRoot, workerId, workflow.id, taskId);
  assert.ok(
    gateSeqs.length === 2 && gateSeqs[1] > gateSeq,
    `precondition: the second gate event is durable at a LATER seq than the first; got ${JSON.stringify(gateSeqs)}`,
  );

  // stage: expect_replay_stable — re-reading the projection must NOT move the bound verdict: the
  // packet count stays >= 1 and the existing verdict still binds the FIRST gate event's seq + bytes.
  const replayed = await workflow.feedback();
  const replayedPackets = (replayed.section?.items ?? [])
    .map((it) => it.value)
    .filter((value) => value?.feedback && value.feedback.gate !== undefined);
  assert.ok(
    replayedPackets.length >= 1,
    'stage: expect_replay_stable — the verdict packet still projects after the second gate event',
  );
  for (const value of replayedPackets) {
    assert.equal(value.gateEventSeq, gateSeq, 'stage: expect_replay_stable — replay binds the ORIGINAL gate event seq');
    assert.equal(value.derived, true, 'stage: expect_replay_stable — replay stays derived:true');
    assert.equal(
      value.feedback?.detail?.digests?.changedPathsDigest,
      DIGEST_A,
      'stage: expect_replay_stable — replay keeps the FIRST gate event bytes, not the second',
    );
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

  // stage: expect_render_verdict_summary — GREEN-4 render half (S3): the feedback section must
  // render a non-undefined verdict summary, and no 'undefined' literal may leak into the section.
  const fb = await workflow.feedback();
  const verdictItem = (fb.section?.items ?? []).find((it) => it.value?.feedback?.gate !== undefined);
  assert.ok(verdictItem, 'precondition: the verdict packet projects in the feedback section');
  assert.equal(
    typeof verdictItem.summary,
    'string',
    'stage: expect_render_verdict_summary — the feedback section renders a verdict summary, '
    + `not ${JSON.stringify(verdictItem.summary)}`,
  );
  assert.ok(
    verdictItem.summary.length > 0,
    'stage: expect_render_verdict_summary — the verdict summary is non-empty',
  );
  assert.ok(
    !JSON.stringify(fb.section).includes('undefined'),
    'stage: expect_render_verdict_summary — no undefined literal leaks into the feedback section',
  );

  // stage: expect_render_verdict_line — the revision objective carries a distinct verdict line
  // (the gate name), never `Feedback: undefined`.
  const plan = await workflow.inspect({ depth: 'section', section: 'plan' });
  const revisionItem = (plan.section?.items ?? []).find((it) => it.id.includes('plan-node:revision:'));
  assert.ok(revisionItem, 'precondition: the revision node projects in the plan section');
  assert.ok(
    revisionItem.value?.objective?.includes('scope'),
    'stage: expect_render_verdict_line — the revision objective carries the verdict gate name',
  );
  assert.ok(
    !revisionItem.value?.objective?.includes('Feedback: undefined'),
    'stage: expect_render_verdict_line — the revision objective never renders Feedback: undefined',
  );
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

test('R6 (RED): B5 per-record degradation — a PERSISTED pre-hardening gate-shaped record is excluded per-record while later records project (stage: expect_pre_hardening_record_excluded)', async (t) => {
  // M1: stage a GENUINE pre-hardening record through `driver.coordination.recordDriver` — the exact
  // 10-field shape `sendWorkflowFeedback` records at HEAD — so the migration code path is REACHED,
  // not vacuous. The capture seam (openBatonDeployment param 2) hands us the driver.
  const { workflow, driver } = await openWorkflow(t, { captureDriver: true });
  const builder = await candidateFor(workflow, 'builder');
  assert.ok(builder?.evidence?.verification?.worker, 'precondition: verified candidate');
  assert.ok(driver?.coordination?.recordDriver, 'precondition: the M1 capture seam produced the driver');

  // The pre-hardening population is PERSISTED STATE — a shape-only gate-shaped packet with no
  // referent event and no hardening metadata, exactly what the forge wrote at HEAD.
  const preHardeningFeedback = scopeGatePayload();
  const stagedSeq = await stagePreHardeningRecord(driver, workflow, builder, preHardeningFeedback);
  assert.ok(Number.isSafeInteger(stagedSeq), 'precondition: the pre-hardening record is durable');

  // PIN (B5 part 1): reading feedback never throws a map-wide application_workflow_integrity — the
  // code path must degrade per-record, not refuse the whole projection.
  const fb = await workflow.feedback();

  // RED (B5 part 2): the pre-hardening gate-shaped record is EXCLUDED per-record from the read.
  assert.equal(
    fb.section?.itemCount ?? 0,
    0,
    'a persisted pre-hardening gate-shaped record must be excluded per-record (B5) at stage: '
    + `expect_pre_hardening_record_excluded; got ${fb.section?.itemCount ?? 0} packet(s)`,
  );

  // RED (B5 part 3): a LATER coaching record still projects — migration is per-record, never
  // map-wide (the coaching packet lands after the excluded pre-hardening one and reads back intact).
  await workflow.sendFeedback('builder', {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable delta.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const after = await workflow.feedback();
  const coachingPacket = after.section?.items?.find((it) => it.value?.target?.role === 'builder')?.value;
  assert.ok(coachingPacket, 'stage: expect_pre_hardening_record_excluded — the later coaching record projects');
  assert.equal(
    coachingPacket.feedback?.summary,
    'Keep the candidate but document the changed path before synthesis.',
    'the later coaching record reads back intact alongside the excluded pre-hardening record',
  );
});

test('R7 (RED): S1 — the referent boundary is candidate-scoped: run-2 same-shaped submission is not bound by run-1 gate (stage: expect_second_run_refused)', async (t) => {
  const { deployment, workflow, adapters, deploymentRoot } = await openWorkflow(t);
  const builder1 = await candidateFor(workflow, 'builder');
  const worker1 = builder1?.evidence?.verification?.worker;
  const taskId1 = builder1?.taskId;
  assert.ok(worker1 && taskId1, 'precondition: verified run-1 builder candidate');

  // Run 1: a REAL gate referent binds a genuine derived verdict — proving a same-shaped record
  // legitimately exists in this deployment (so run 2's refusal is a scoping fact, not a void).
  emitScopeGateEvent(adapters.codex, worker1);
  await workflow.sendFeedback('builder', scopeGatePayload()).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  const fb1 = await workflow.feedback();
  const verdict1 = (fb1.section?.items ?? [])
    .map((it) => it.value)
    .find((value) => value?.feedback?.gate !== undefined);
  assert.ok(verdict1, 'precondition: run-1 recorded a bound gate-shaped verdict');

  // Run 2: the SAME deployment, a SECOND workflow/run. Its builder worker has NO gate event on its
  // OWN run — run 1's gate must not bind this submission.
  const w2 = await deployment.workflow(OBJECTIVE_2, {
    team: [
      { role: 'builder', exact: ROUTE_A },
      { role: 'challenger', exact: ROUTE_B },
    ],
  });
  await w2.complete();
  const builder2 = await candidateFor(w2, 'builder');
  const worker2 = builder2?.evidence?.verification?.worker;
  const taskId2 = builder2?.taskId;
  assert.ok(worker2 && taskId2, 'precondition: verified run-2 builder candidate');

  const w2Events = readFileSync(join(deploymentRoot, 'state', `${worker2}.jsonl`), 'utf8')
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const w2Gates = w2Events.filter((event) => (
    event.kind === 'error'
    && event.payload?.code === 'worker_path_scope_violation'
    && event.runId === w2.id && event.taskId === taskId2
  ));
  assert.equal(
    w2Gates.length,
    0,
    'precondition: run-2 builder worker stream has no gate event on its own run (the referent lookup '
    + 'is runId+taskId scoped, so run-1 gate cannot bind)',
  );

  // stage: expect_second_run_refused — the SAME-shaped {gate, detail} for run 2's builder refuses
  // the typed gate-unbound and appends nothing. (RED at HEAD: the forge accepts it — cross-run
  // verdict laundering unobserved.)
  const outcome = await w2.sendFeedback('builder', scopeGatePayload()).then(
    (value) => ({ ok: true }),
    (error) => ({ ok: false, code: error?.code, message: error?.message }),
  );
  assert.equal(
    outcome.ok,
    false,
    'run-1 gate must not bind run-2 same-shaped submission — the referent boundary is candidate-scoped '
    + '(runId+taskId) at stage: expect_second_run_refused',
  );
  assert.equal(
    outcome.code,
    'application_workflow_feedback_gate_unbound',
    `refusal must be the typed gate-unbound code; got ${outcome.code}`,
  );
  const fb2 = await w2.feedback();
  assert.equal(fb2.section?.itemCount ?? 0, 0, 'stage: expect_second_run_refused — the refusal appends nothing');
});

test('R8 (RED): M3 — D4 surface constancy: gate_unbound is typed in application.mjs and preserved verbatim through web/MCP facades (stage: expect_gate_unbound_typed)', () => {
  // RED (D4 part 1): the code is absent from application.mjs at HEAD — the hardened projection must
  // type it (the R1/R7 refusal path produces it).
  const applicationSource = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  assert.ok(
    applicationSource.includes('application_workflow_feedback_gate_unbound'),
    'stage: expect_gate_unbound_typed — the gate-unbound refusal code is typed in application.mjs',
  );

  // PIN (D4 part 2): the web-northbound mapper preserves ANY application_* code verbatim through its
  // generic fallthrough (web-northbound.mjs:206-209), so a typed gate_unbound surfaces unchanged.
  const webSource = readFileSync(new URL('../src/web-northbound.mjs', import.meta.url), 'utf8');
  assert.match(
    webSource,
    /goalPlanCode\.startsWith\(['"]application_['"]\)/u,
    'D4: web-northbound preserves application_* codes through its generic fallthrough',
  );

  // PIN (D4 part 3): the mcp-northbound error mapper returns cause.code verbatim for application_*.
  const mcpSource = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  assert.match(
    mcpSource,
    /cause\.code\.startsWith\(['"]application_['"]\)/u,
    'D4: mcp-northbound returns application_* codes verbatim',
  );
});
