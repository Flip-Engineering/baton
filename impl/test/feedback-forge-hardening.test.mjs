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
//               exact `{kind, code, message, gate, check, detail:{digests, counts}, corrective}`
//               shape (folded #61 D1/C3 extends the leg with the hub-minted check +
//               corrective; a forged verdict still cannot mint hub fields). [DG-1b harness]
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
// VERIFIED SPLIT (run `node --test impl/test/feedback-forge-hardening.test.mjs` TWICE from repo root)
//   Run 1: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)   — stable
//   Run 2: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)   — stable
//
// NUL DISCIPLINE: application.mjs and coordination-store.mjs carried literal NUL bytes until #215
// spelled them `\0`; plain `grep` reads both files as text now. This suite reads sources with
// `readFileSync(..., 'utf8')` + string scanning.
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
// DG-1b harness (mirrors diagnostics.test.mjs) — for P1, P3, P4.
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
      // The fixture route carries its own credential state, the way MockAdapter fixtures do;
      // readiness must never read this host's provider credentials.
      providerCompatibility: { credentialState: 'available' },
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'feedback-forge-hardening', refreshedAt: null,
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
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'ffh@example.invalid', GIT_COMMITTER_EMAIL: 'ffh@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'FFH', GIT_COMMITTER_NAME: 'FFH' });
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
    // The fixture route carries its own credential state, the way MockAdapter fixtures do;
    // readiness must never read this host's provider credentials.
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'feedback-forge-hardening', refreshedAt: null,
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
    check: 'path_scope',
    detail: {
      digests: {
        changedPathsDigest: DIGEST_A,
        inScopeChangedPathsDigest: DIGEST_B,
        outOfScopeChangedPathsDigest: DIGEST_C,
      },
      counts: { changedPathCount: 1, inScopeChangedPathCount: 0, outOfScopeChangedPathCount: 1 },
    },
    corrective: 'in_scope_revision',
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
  const suitePath = new URL('./worker-delivery-push.test.mjs', import.meta.url);
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

test('P7 (PIN): the contract refusal vocabulary is typed and surface-constant across the application seam', () => {
  // slice 15: the feedback projections (and their refusal literals) moved to
  // application-observation.mjs — the vocabulary is scanned across both texts.
  const source = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/application-observation.mjs', import.meta.url), 'utf8');
  for (const code of [
    'application_workflow_feedback_invalid',
    'application_workflow_feedback_anchor_invalid',
    'application_workflow_feedback_unavailable',
    'application_workflow_integrity',
  ]) {
    assert.ok(source.includes(code), `refusal code ${code} is typed across the application seam`);
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








