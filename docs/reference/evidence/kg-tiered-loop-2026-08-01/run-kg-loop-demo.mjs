// DEMO v3 — the tiered knowledge loop as explicit acceptance:
//   worker scratchpad (task-ephemeral, LIVE wire via SCRATCHPAD_WRITE lines)
//   → orchestrator elevation to the shared workflow partition (+ ScratchFact mint for notes)
//   → board-close candidacy → lease-gated admission (verified Finding in the project KG)
//   → workflow settle → horizon digests before/after.
//
// Phase 1 runs a real deepseek wave through openBaton + createWaveDriver. Phase 2 reopens the
// same deployment's coordination store directly (single writer, facade closed first) and
// performs the orchestrator ritual step by step — every step receipted.
//
// Honest scope note (filed as an issue): the ritual methods (elevateTaskScratchpad,
// settleWorkflowScratchpad, admitWorkflowFinding) have ZERO live call sites — no application
// command, no MCP tool, no wave-driver hook reaches them; this script drives the store path
// the way production settle-time wiring would. The lease gate also requires an OPEN parent
// run (_assertRunAdmissionOpen refuses run_stopping), so the admission rides a synthetic
// orchestrator settlement run — the wave run is already stopped when Phase 2 begins.
//
// Usage: node run-kg-loop-demo.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBaton, createWaveDriver, DEFAULT_RUN_LINEAGE_POLICY, normalizeTaskTopologyPolicy, normalizeWorkflowPolicy } from '../../../../impl/src/index.mjs';
import { normalizeGoalPlanPolicy } from '../../../../impl/src/goal-plan.mjs';
import { Log } from '../../../../impl/src/log.mjs';
import { CoordinationStore } from '../../../../impl/src/coordination-store.mjs';

// The deployment's goalPlanPolicy (application-deployment.mjs:849) — replicated verbatim so the
// replay integrity digests match the store the live deployment wrote. DEFAULT_BUDGET is the
// deployment constant (tokens 100M, usd 1000, wallMin 480, providerTurns 2048).
const deploymentGoalPlanPolicy = (repoId) => normalizeGoalPlanPolicy(Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 480 * 60_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['baton_orchestrator', 'code', 'test'],
  limits: {
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
    maxTextBytes: 16_384, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
    maxGoalBytes: 256 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 1024 * 1024,
    maxTokens: 100_000_000, maxUsd: 1_000, maxWallMin: 480, maxProviderTurns: 2_048,
  },
}));

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-tiered-loop-2026-08-01');
const DEPLOYMENT_ROOT = resolve(repo, '.baton', 'kg-tiered-loop-2026-08-01');
const ATTEMPT = new Date().toISOString();
const SALT = `kgl${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[kg-loop ${new Date().toISOString()}] ${line}`);
const digest = (value) => {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};

const receipts = { attempt: ATTEMPT, salt: SALT, phases: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'kg-loop-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);

// RITUAL_ONLY=1 skips the live wave (already landed) and re-runs only the orchestrator ritual
// over the persisted deployment. BATON_DEMO_REPO_ID carries the deployment's repoId then.
const RITUAL_ONLY = process.env.RITUAL_ONLY === '1';

// ---------------------------------------------------------------------------
// PHASE 1 — the live wave: one deepseek surveyor writes three valid scratchpad
// entries (note/plan/doubt) through the real wire path, one per assistant
// message (the session scanner admits one SCRATCHPAD_WRITE per message).
// ---------------------------------------------------------------------------
let waveRunId = null;
let waveOutcome = null;
if (!RITUAL_ONLY) {
  const baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot: DEPLOYMENT_ROOT,
      routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
      verification: Object.freeze({ command: 'true', arguments: [] }),
    },
  });
  try {
    const card = baton.card();
    receipts.repoId = card.repoId ?? null;
    log(`deployment open, repoId ${receipts.repoId ?? 'UNKNOWN'}`);
    const driver = createWaveDriver(baton, {
      steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
      pollIntervalMs: 15_000, stallTimeoutMs: 20 * 60_000, hardCapMs: 40 * 60_000,
      settleTimeoutMs: 15_000, saltObjectives: false, preflight: true,
      onProgress: (line) => log(`progress ${line}`),
    });
    const receipt = await driver.run({
      members: [{
        role: 'surveyor',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/kg-tiered-loop-2026-08-01/**'],
        objective: [
          `[attempt: kg-loop-${ATTEMPT}]`,
          'You are the surveyor in a knowledge-graph tiered-loop acceptance. Survey impl/src/run-lineage.mjs (the run-orchestrator lease machinery).',
          `Print EXACTLY three SCRATCHPAD_WRITE lines across THREE SEPARATE assistant messages — one line per message, never two in one message (the wire admits one per message). Each is TEXT you print, never a tool you call. The exact lines:`,
          `LINE 1 (print, then read impl/src/run-lineage.mjs lines 1-120): SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"A run-orchestrator lease binds a working parent task carrying the baton_orchestrator capability, and the parent run must not be stopping when the lease is issued."},"expectedFence":"current","idempotencyKey":"${SALT}-note"}`,
          `LINE 2 (print, then read impl/src/run-lineage.mjs lines 120-260): SCRATCHPAD_WRITE: {"entry":{"kind":"plan","objective":"verify the tiered knowledge loop","steps":[{"text":"survey run-lineage lease machinery","state":"done"},{"text":"record findings as scratchpad entries","state":"doing"},{"text":"hand off to orchestrator elevation","state":"todo"}],"supersedes":null},"expectedFence":"current","idempotencyKey":"${SALT}-plan"}`,
          `LINE 3 (print, then write the report): SCRATCHPAD_WRITE: {"entry":{"kind":"doubt","question":"Does a stopped parent run refuse a new orchestrator lease at admission time?","context":"_assertRunAdmissionOpen throws run_stopping for stopped runs; the settle-time ritual must therefore run before run stop."},"expectedFence":"current","idempotencyKey":"${SALT}-doubt"}`,
          'Then write docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-surveyor-report.md with three short sections (Lease issuance / Revocation / What the orchestrator must guarantee), each grounded in file:line references to impl/src/run-lineage.mjs. Work in ONE continuous turn until the report is written.',
        ].join(' '),
      }],
    });
    waveOutcome = receipt.outcomes?.[0] ?? {};
    receipts.phases.push({
      phase: 1,
      outcome: { phase: waveOutcome.phase, terminal: waveOutcome.terminal ?? null, resultSha: waveOutcome.resultSha ?? null },
      basis: receipt.basis ?? null,
    });
    log(`wave settled: outcome ${waveOutcome.phase}, result ${waveOutcome.resultSha ?? 'none'}`);

    const runs = await baton.runs.list();
    const row = (runs?.runs ?? runs ?? [])[0] ?? null;
    waveRunId = row?.runId ?? row?.id ?? null;
    receipts.phases.push({ phase: 1.1, runRow: row ? { runId: waveRunId, phase: row.phase ?? null } : null });
    log(`wave run: ${waveRunId ?? 'NOT FOUND (phase 2 will fall back to the store snapshot)'}`);
  } finally {
    persist();
    await baton.close().catch(() => {});
  }
  log('facade closed — writer lease released; beginning the orchestrator ritual');
} else {
  receipts.repoId = process.env.BATON_DEMO_REPO_ID ?? null;
  receipts.phases.push({ phase: 1, ritualOnly: true, note: 'live wave already landed; ritual re-run over the persisted store' });
  if (!receipts.repoId) throw new Error('RITUAL_ONLY requires BATON_DEMO_REPO_ID');
  log(`ritual-only mode over persisted deployment, repoId ${receipts.repoId}`);
}

// ---------------------------------------------------------------------------
// PHASE 2 — the orchestrator ritual over the same coordination store:
//   steering binding → orchestrator lease parent → elevation → board candidacy
//   → lease-gated admission → workflow settle → horizon digests.
// ---------------------------------------------------------------------------
const operationalLog = new Log(join(DEPLOYMENT_ROOT, 'state'));
const store = new CoordinationStore(join(DEPLOYMENT_ROOT, 'state', 'coordination'), {
  repoId: receipts.repoId,
  // The deployment's policy set verbatim (application-deployment.mjs:1690-1706) — replay
  // integrity validates goal/plan + topology + workflow events against the configured policies.
  goalPlanPolicy: deploymentGoalPlanPolicy(receipts.repoId),
  taskTopologyPolicy: normalizeTaskTopologyPolicy(),
  workflowPolicy: normalizeWorkflowPolicy(undefined),
  runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  operationalRead: (worker, seq) => operationalLog.at(worker, seq),
  operationalRangeRead: (worker, throughSeq) => operationalLog.range(worker, throughSeq),
  clock: () => new Date().toISOString(),
});
store.claimWriterLease();
try {
  const ritual = { phase: 2, steps: [] };
  const step = (name, receipt) => {
    ritual.steps.push({ name, receipt: receipt ?? null });
    log(`ritual ${name}: ${receipt?.ok ?? receipt?.result ?? 'done'}`);
  };

  // 0. Discover the wave member's task/worker + read the worker partition.
  const snapshot = store.snapshot();
  if (!waveRunId) {
    waveRunId = snapshot.runs[0]?.runId ?? snapshot.runs[0]?.id
      ?? snapshot.tasks.find((row) => row.runId)?.runId ?? null;
    ritual.steps.push({ name: 'run-discovery-fallback', receipt: { runId: waveRunId } });
  }
  const task = snapshot.tasks.find((row) => row.runId === waveRunId && row.assignee)
    ?? snapshot.tasks.find((row) => row.runId === waveRunId);
  if (!task) throw new Error(`demo: no task found for run ${waveRunId}`);
  const workerId = task.assignee ?? task.reservedWorkerId;
  const workerScope = `worker:${workerId}`;
  const workerFence = store.scratchpadFence(waveRunId, workerScope);
  const workerSlice = store.scratchpadSnapshot(waveRunId, workerScope);
  step('discover', {
    taskId: task.id, workerId, taskStatus: task.status, workerFence,
    workerEntries: workerSlice.entries.map((row) => ({ entryId: row.entryId, kind: row.kind })),
  });
  if (workerSlice.entries.length === 0) {
    throw new Error('demo: the worker wrote no scratchpad entries — the live wire path failed');
  }

  // 0b. The wire receipts from the worker's operational log (#62's evidence class).
  const stateDir = join(DEPLOYMENT_ROOT, 'state');
  const writeResults = [];
  for (const name of readdirSync(stateDir).filter((n) => /\.jsonl$/u.test(n))) {
    for (const line of readFileSync(join(stateDir, name), 'utf8').split('\n')) {
      if (!line.includes('scratchpad.write_result')) continue;
      try {
        const event = JSON.parse(line);
        if (event.kind === 'scratchpad.write_result') {
          writeResults.push({ log: name, ok: event.payload?.ok ?? null, result: event.payload?.result ?? null });
        }
      } catch { /* partial line */ }
    }
  }
  step('wire-receipts', { writeResults });

  const kgBefore = {
    nodes: store.queryKnowledge({}).length,
    edges: store.queryKnowledgeEdges({}).length,
    sharedFence: store.scratchpadFence(waveRunId, 'shared'),
  };
  step('horizons-before', kgBefore);

  // 1. The durable steering binding rule 19/20 requires of an elevating orchestrator.
  store.recordDriver('steering.registered', { runId: waveRunId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${waveRunId}` });
  step('steering-registered', { runId: waveRunId });

  // 2. Elevate the note + doubt (the plan is deliberately NOT elevated — the
  //    orchestrator curates; its disposition must read orchestrator_skipped).
  const selected = workerSlice.entries.filter((row) => row.kind === 'note' || row.kind === 'doubt')
    .map((row) => row.entryId);
  const elevation = store.elevateTaskScratchpad({
    runId: waveRunId, taskId: task.id, workerId,
    expectedScratchpadFence: workerFence, entryIds: selected,
  }, { actor: 'orchestrator', key: `scratchpad.task_settlement:${task.id}` });
  step('elevate', {
    result: elevation.result, elevated: elevation.elevated,
    scratchpadFence: elevation.scratchpadFence,
  });

  // 3. Orchestrator settlement run + lease (the admission gate's authority).
  const orchRunId = `run-${SALT}-orchestrator`;
  const orchTaskId = `task-${SALT}-orchestrator`;
  const orchWorkerId = `worker-${SALT}-orchestrator`;
  store.createTask({
    id: orchTaskId, brief: { objective: 'orchestrate the tiered-loop settlement', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: orchRunId, taskType: 'general',
    reservedWorkerId: orchWorkerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${orchTaskId}` });
  const orchTask = store.claimTask(orchTaskId, orchWorkerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${orchTaskId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@ritual',
      modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
      effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
      routeKey: '["kimi-code","ritual","kimi-code/k3","max"]',
    }).task;
  const session = {
    principalId: `principal-${SALT}`, sessionId: `session-${SALT}`,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: `principal-${SALT}`, sessionId: `session-${SALT}` }),
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const issued = store.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId: receipts.repoId, parentTask: { id: orchTaskId, version: orchTask.version }, session },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${SALT}` },
  );
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  step('lease', { leaseId: lease.id.slice(0, 40), parentRunId: orchRunId });

  // 4. Board candidacy: the curated finding posts + closes → candidate Finding.
  const noteEntry = workerSlice.entries.find((row) => row.kind === 'note');
  const posted = store.postBoardItem({
    board: `board-${SALT}`,
    title: `surveyor finding: ${noteEntry?.content?.text?.slice(0, 120) ?? 'run-lineage lease binding'}`,
    detail: `Elevated from ${workerId}'s task-ephemeral scratchpad (entry ${noteEntry?.entryId ?? 'n/a'}); shared entry ${elevation.elevated?.[0]?.sharedEntryId ?? 'n/a'}.`,
  }, { actor: 'orchestrator', key: `board.posted:${SALT}` });
  const closed = store.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: `board.closed:${SALT}` });
  const candidateFindingId = `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`;
  step('board-candidacy', { itemId: posted.item.itemId.slice(0, 40), itemVersion: closed.item.itemVersion, candidateFindingId: candidateFindingId.slice(0, 60) });

  // 5. The admission gate: lease-bound, policy-bounded, idempotent.
  const policy = Object.freeze({ repoId: receipts.repoId, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });
  const admitted = store.admitWorkflowFinding(receipts.repoId, orchRunId, candidateFindingId, policy,
    { actor: 'orchestrator', key: `knowledge.workflow_admitted:${candidateFindingId}` }, lease);
  step('admit', {
    findingId: admitted.finding?.id?.slice(0, 72) ?? null,
    grounding: admitted.finding?.grounding ?? null,
    trigger: admitted.finding?.promotion?.trigger ?? null,
    replayed: admitted.replayed,
  });

  // 6. Workflow settle: the shared partition is reaped, scratch facts expired.
  const sharedFence = store.scratchpadFence(waveRunId, 'shared');
  const settled = store.settleWorkflowScratchpad(
    { runId: waveRunId, expectedScratchpadFence: sharedFence, skips: [] },
    { actor: 'orchestrator', key: `scratchpad.workflow_settlement:${waveRunId}` },
  );
  step('settle', {
    result: settled.result, reapEventSeq: settled.reapEventSeq,
    expiredScratchFactIds: settled.expiredScratchFactIds,
  });

  const kgAfter = {
    nodes: store.queryKnowledge({}).length,
    edges: store.queryKnowledgeEdges({}).length,
    sharedFence: store.scratchpadFence(waveRunId, 'shared'),
  };
  const promoted = store.queryKnowledge({}).find((node) => node.promotion?.trigger === 'workflow.admitted') ?? null;
  const dispositions = store.scratchpadSnapshot(waveRunId, workerScope);
  step('horizons-after', {
    ...kgAfter,
    promotedFinding: promoted ? { id: promoted.id.slice(0, 72), grounding: promoted.grounding } : null,
    workerPartitionAfter: dispositions.entries.length,
  });

  ritual.verdict = kgAfter.nodes > kgBefore.nodes && promoted ? 'TIERED-LOOP-OK' : 'TIERED-LOOP-INCOMPLETE';
  receipts.phases.push(ritual);
  log(`verdict: ${ritual.verdict} (KG nodes ${kgBefore.nodes} → ${kgAfter.nodes}, promoted ${promoted ? 'present' : 'ABSENT'})`);
} catch (error) {
  receipts.phases.push({
    phase: 2, failed: true,
    error: { code: error?.code ?? null, name: error?.name ?? null, message: String(error?.message ?? error).slice(0, 400) },
  });
  persist();
  store.releaseWriterLease({ requireOwned: true });
  throw error;
} finally {
  persist();
}

try {
  store.releaseWriterLease({ requireOwned: false });
} catch { /* already released on the failure path */}
log('receipt written to kg-loop-receipt.json');
log(receipts.phases.at(-1).verdict === 'TIERED-LOOP-OK' ? 'KG-LOOP-OK' : 'KG-LOOP-INCOMPLETE');
