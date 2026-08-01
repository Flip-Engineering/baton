// DEMO v3b — the tiered knowledge loop END-TO-END inside the run's live settle window.
//
// Why the manual stack: v3 proved (live, receipted) that the shipped wave driver can never run
// this ritual — run.stop precedes it, and elevation/lease both refuse run_stopping. The ritual
// is designed for the pre-stop settle window, and no shipped surface drives it there. So this
// script assembles the stack the way production wiring would (createDriver + BatonApplication +
// bindBaton — the same pieces openBatonDeployment composes), holds driver.coordination, starts
// the wave WITHOUT the auto-stopping driver, waits for the member's resting state, performs the
// full orchestrator ritual while the run is OPEN, then closes the wave.
//
//   worker scratchpad (task-ephemeral, LIVE wire) → steering binding → elevation to shared
//   (+ ScratchFact mint) → board-close candidacy → lease-gated admission (verified Finding)
//   → workflow settle → horizon digests → wave close (run stops AFTER the ritual).
//
// Usage: node run-kg-loop-live.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bindBaton, createDriver, DEFAULT_RUN_LINEAGE_POLICY } from '../../../../impl/src/index.mjs';
import { BatonApplication } from '../../../../impl/src/application.mjs';
import { GlmSessionCli } from '../../../../impl/src/claude-session.mjs';
import { normalizeGoalPlanPolicy } from '../../../../impl/src/goal-plan.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST } from '../../../../impl/src/worker-policy.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-tiered-loop-2026-08-01');
const ATTEMPT = new Date().toISOString();
const SALT = `kgv${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const STATE_ROOT = resolve(repo, '.baton', `kg-tiered-loop-v3b-${SALT}`);
const repoId = `repo-${SALT}`;
const log = (line) => console.log(`[kg-live ${new Date().toISOString()}] ${line}`);
const digest = (value) => {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const receipts = { attempt: ATTEMPT, salt: SALT, repoId, phases: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'kg-loop-live-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);

// The deployment's goalPlanPolicy (application-deployment.mjs:849), replicated verbatim EXCEPT
// mandatory:false — under a mandatory policy, the settlement run's orchestrator parent task must
// be plan-dispatched (createTask refuses goal_plan_required otherwise); that is production wiring
// constraint #3, receipted in the demo verdict. The demo deployment chooses non-mandatory.
const goalPlanPolicy = normalizeGoalPlanPolicy(Object.freeze({
  schemaVersion: 1, repoId, mandatory: false, approvalTtlMs: 480 * 60_000,
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

const profile = Object.freeze({
  schemaVersion: 2,
  repoId,
  definitionOfDone: [
    'The requested repository improvement is implemented and verified.',
    'Baton preserves exact route, result, and cleanup truth.',
  ],
  constraints: ['Do not claim completion without the deployment verification command.'],
  risk: 'high',
  goalBudget: Object.freeze({ tokens: 100_000_000, usd: 1_000, wallMin: 480, providerTurns: 2_048 }),
  nodeBudget: Object.freeze({ tokens: 100_000_000, usd: 1_000, wallMin: 480, providerTurns: 2_048 }),
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 480 * 60_000, maxOutputBytes: 1024 * 1024,
    requiredPredecessorEvidence: [],
  },
  routes: [Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'high' })],
  capabilities: ['baton_orchestrator', 'code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  requiredEffects: ['repository_edit'],
  workerPolicy: DEFAULT_WORKER_POLICY_REQUEST,
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  integrationPolicy: {
    mode: 'manual', strategies: ['ff-only', 'structured'],
    requireAdoptedResult: true, requireSemanticReview: false,
  },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 30_000, maxChanges: 128,
    maxResponseBytes: 512 * 1024, maxScanEvents: 1024,
  },
  exportPolicy: {
    mode: 'manual', format: 'directory-v1', maxFiles: 256, maxBytes: 16 * 1024 * 1024,
    requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: true,
  },
});

const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
log(`assembling the driver stack (repoId ${repoId}, base ${headSha.slice(0, 12)})`);

const driver = createDriver({
  repoRoot: repo,
  repoId,
  deploymentBaseSha: headSha,
  logDir: STATE_ROOT,
  adapters: {
    'glm:glm': new GlmSessionCli({
      authTokenFile: resolve(repo, 'glm_key.json'), authTokenJsonPointer: '/glm_key',
      harness: 'glm', model: 'glm-5.2', approvals: false, ceiling: 1,
    }),
  },
  goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
  runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
});

const service = (name) => Object.freeze({
  actor: `deployment:${name}`, principalId: `service-${name}`, sessionId: `service-${name}-session`,
});
const principal = Object.freeze({
  actor: `deployment:${repoId}`, principalId: 'local-owner', sessionId: 'local-owner-session',
});
const EXPORT_ROOT = resolve(STATE_ROOT, 'exports');
mkdirSync(EXPORT_ROOT, { recursive: true, mode: 0o700 });
chmodSync(EXPORT_ROOT, 0o700);
const application = new BatonApplication({
  driver, repoId,
  profiles: { default: profile },
  defaults: { profile: 'default', route: { harness: 'glm', model: 'glm-5.2', effort: 'high' } },
  principals: { planner: service('planner'), dispatcher: service('dispatcher'), observer: service('observer') },
  exportRoot: EXPORT_ROOT,
  authorize: async () => true,
});
await application.ready;
const baton = bindBaton(application, principal);
const store = driver.coordination;
log('stack assembled — starting the wave (no auto-stop; the ritual fires at resting)');

let wave = null;
let waveRunId = null;
try {
  wave = await baton.waves.start({
    members: [{
      role: 'surveyor',
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/kg-tiered-loop-2026-08-01/**'],
      objective: [
        `[attempt: kg-live-${ATTEMPT}]`,
        'You are the surveyor in a knowledge-graph tiered-loop acceptance. Survey impl/src/run-lineage.mjs (the run-orchestrator lease machinery).',
        'FIRST, before anything else, write docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-surveyor-report.md with the three section headings (Lease issuance / Revocation / What the orchestrator must guarantee) and one-line stubs — an in-scope file diff must exist from your first minutes (the worktree progress gate kills workers with no diff).',
        'Then print EXACTLY three SCRATCHPAD_WRITE lines across THREE SEPARATE assistant messages — one line per message, never two in one message (the wire admits one per message). Each is TEXT you print, never a tool you call. The exact lines:',
        `LINE 1 (print, then read impl/src/run-lineage.mjs lines 1-120): SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"A run-orchestrator lease binds a working parent task carrying the baton_orchestrator capability, and the parent run must not be stopping when the lease is issued."},"expectedFence":"current","idempotencyKey":"${SALT}-note"}`,
        `LINE 2 (print, then read impl/src/run-lineage.mjs lines 120-260): SCRATCHPAD_WRITE: {"entry":{"kind":"plan","objective":"verify the tiered knowledge loop","steps":[{"text":"survey run-lineage lease machinery","state":"done"},{"text":"record findings as scratchpad entries","state":"doing"},{"text":"hand off to orchestrator elevation","state":"todo"}],"supersedes":null},"expectedFence":"current","idempotencyKey":"${SALT}-plan"}`,
        `LINE 3 (print, then deepen the report): SCRATCHPAD_WRITE: {"entry":{"kind":"doubt","question":"Does a stopped parent run refuse a new orchestrator lease at admission time?","context":"_assertRunAdmissionOpen throws run_stopping for stopped runs; the settle-time ritual must therefore run before run stop."},"expectedFence":"current","idempotencyKey":"${SALT}-doubt"}`,
        'Finally deepen each report section to a short paragraph grounded in file:line references to impl/src/run-lineage.mjs. Work in ONE continuous turn until the report is complete.',
      ].join(' '),
    }],
  });
  const runHandle = wave.runs.get('surveyor');
  waveRunId = runHandle?.id ?? null;
  log(`wave started, member run ${waveRunId ?? 'pending'}`);
  receipts.phases.push({ phase: 1, runId: waveRunId });

  // Wait for the member's resting state AND the store task's terminal status — WITHOUT stopping
  // the run. (The shipped wave driver's settle→close would stop it; that is exactly the v3 gap.)
  const deadline = Date.now() + 30 * 60_000;
  let resting = false;
  let dead = null;
  let lastPhase = null;
  const nudgedRequestIds = new Set(); // L4: one nudge per pause (requestId-stable across polls)
  const claimedRequestIds = new Set();
  while (Date.now() < deadline && !resting && !dead) {
    await sleep(15_000);
    const view = await runHandle.status().catch(() => null);
    const outline = view?.view ?? view ?? {};
    const phase = outline.phase ?? outline.outline?.phase ?? null;
    const advertised = view?.actions ?? outline?.actions ?? [];
    if (Array.isArray(advertised) && advertised.some((action) => action?.kind === 'approve_plan')) {
      await runHandle.approve().catch(() => {});
    }
    // nudge-on-checkpoint steering (the wave driver's L4): a turn_checkpoint park is driven
    // forward by nudge_turn (once per requestId); a claim-carrying checkpoint is claimed
    // (claim_turn re-runs the live trust gate and resolves the parked turn).
    const attention = view?.attention ?? outline?.attention ?? [];
    const checkpoint = Array.isArray(attention)
      ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string')
      : null;
    if (checkpoint) {
      if (checkpoint.claim != null && !claimedRequestIds.has(checkpoint.requestId)) {
        claimedRequestIds.add(checkpoint.requestId);
        const result = await runHandle.act('claim_turn', {}).catch((error) => ({ error: String(error?.message ?? error) }));
        log(`steering claim_turn ${checkpoint.requestId.slice(0, 24)} → ${JSON.stringify(result).slice(0, 120)}`);
      } else if (!nudgedRequestIds.has(checkpoint.requestId)) {
        nudgedRequestIds.add(checkpoint.requestId);
        const result = await runHandle.act('nudge_turn', { message: 'Continue to completion: finish the remaining survey and the report.' })
          .catch((error) => ({ error: String(error?.message ?? error) }));
        log(`steering nudge_turn ${checkpoint.requestId.slice(0, 24)} → ${JSON.stringify(result).slice(0, 120)}`);
      }
    }
    const taskRow = store.snapshot().tasks.find((row) => row.runId === waveRunId);
    const taskStatus = taskRow?.status ?? null;
    if (phase !== lastPhase) {
      log(`progress surveyor phase=${phase ?? '?'} task=${taskStatus ?? '?'} checkpoint=${checkpoint ? checkpoint.requestId.slice(0, 24) : 'none'}`);
      lastPhase = phase;
    }
    if (['work_completed', 'completed', 'result_ready'].includes(phase) && taskStatus === 'completed') {
      resting = true;
    } else if (['cancelled', 'failed'].includes(phase) || ['failed', 'cancelled'].includes(taskStatus)) {
      dead = { phase, taskStatus };
    }
  }
  if (dead) throw new Error(`demo: the surveyor died (${dead.phase}/${dead.taskStatus}) — see the worker log`);
  if (!resting) throw new Error('demo: the surveyor never reached a resting state');
  receipts.phases.push({ phase: 1.1, resting: true, runId: waveRunId });
  persist();
  log('surveyor resting, run OPEN — performing the orchestrator ritual');

  // -------------------------------------------------------------------------
  // THE RITUAL (run open): steering binding → elevation → orchestrator lease →
  // board candidacy → lease-gated admission → workflow settle → horizons.
  // -------------------------------------------------------------------------
  const ritual = { phase: 2, steps: [] };
  const step = (name, receipt) => {
    ritual.steps.push({ name, receipt: receipt ?? null });
    log(`ritual ${name}: ${receipt?.ok ?? receipt?.result ?? 'done'}`);
  };

  const snapshot = store.snapshot();
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

  const kgBefore = {
    nodes: store.queryKnowledge({}).length,
    edges: store.queryKnowledgeEdges({}).length,
    sharedFence: store.scratchpadFence(waveRunId, 'shared'),
  };
  step('horizons-before', kgBefore);

  store.recordDriver('steering.registered', { runId: waveRunId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${waveRunId}` });
  step('steering-registered', { runId: waveRunId });

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
  // The idempotency key binds the DERIVED lease identity (store :1789) — computed exactly as the
  // store derives it: run-orchestrator-lease:<canonicalDigest(identity)>.
  const leaseIdentity = {
    repoId, parentRunId: orchRunId, parentTaskId: orchTaskId, parentTaskVersion: orchTask.version,
    workerId: orchWorkerId, principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(leaseIdentity)}`;
  const issued = store.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId, parentTask: { id: orchTaskId, version: orchTask.version }, session },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` },
  );
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  step('lease', { leaseId: lease.id.slice(0, 40), parentRunId: orchRunId });

  const noteEntry = workerSlice.entries.find((row) => row.kind === 'note');
  const posted = store.postBoardItem({
    board: `board-${SALT}`,
    title: `surveyor finding: ${noteEntry?.content?.text?.slice(0, 120) ?? 'run-lineage lease binding'}`,
    detail: `Elevated from ${workerId}'s task-ephemeral scratchpad (entry ${noteEntry?.entryId ?? 'n/a'}); shared entry ${elevation.elevated?.[0]?.sharedEntryId ?? 'n/a'}.`,
  }, { actor: 'orchestrator', key: `board.posted:${SALT}` });
  const closed = store.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: `board.closed:${SALT}` });
  const candidateFindingId = `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`;
  step('board-candidacy', { itemId: posted.item.itemId.slice(0, 40), itemVersion: closed.item.itemVersion, candidateFindingId: candidateFindingId.slice(0, 60) });

  const policy = Object.freeze({ repoId, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });
  const admitted = store.admitWorkflowFinding(repoId, orchRunId, candidateFindingId, policy,
    { actor: 'orchestrator', key: `knowledge.workflow_admitted:${candidateFindingId}` }, lease);
  step('admit', {
    findingId: admitted.finding?.id?.slice(0, 72) ?? null,
    grounding: admitted.finding?.grounding ?? null,
    trigger: admitted.finding?.promotion?.trigger ?? null,
    replayed: admitted.replayed,
  });

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
  step('horizons-after', {
    ...kgAfter,
    promotedFinding: promoted ? { id: promoted.id.slice(0, 72), grounding: promoted.grounding } : null,
  });

  ritual.verdict = kgAfter.nodes > kgBefore.nodes && promoted ? 'TIERED-LOOP-OK' : 'TIERED-LOOP-INCOMPLETE';
  receipts.phases.push(ritual);
  persist();
  log(`verdict: ${ritual.verdict} (KG nodes ${kgBefore.nodes} → ${kgAfter.nodes}, promoted ${promoted ? 'present' : 'ABSENT'})`);
} finally {
  persist();
  if (wave) {
    const closedWave = await wave.close({ reason: 'tiered-loop settlement complete' }).catch((error) => ({ error: String(error?.message ?? error) }));
    receipts.phases.push({ phase: 3, waveClosed: true, remainingCount: closedWave?.remainingCount ?? null });
    persist();
  }
  await application.shutdown(principal).catch(() => {});
}
log(receipts.phases.find((phase) => phase.verdict)?.verdict === 'TIERED-LOOP-OK' ? 'KG-LOOP-OK' : 'KG-LOOP-INCOMPLETE');
