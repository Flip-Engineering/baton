// #75 BD3 LIVE ACCEPTANCE — the collaboration spine exercised by a REAL worker end-to-end:
//   BD3-A: the worker prints a CONTEXT_READ wire line → the claude-family scanner emits
//          context.read → the coordinator admits (server-derived run horizon) → the framed
//          UNTRUSTED answer is nudged back into the worker's provider-bound frame → the
//          worker quotes the seeded canary it could ONLY have learned through that frame.
//   BD3-C: the orchestrator sends a kind:query message mid-work (target {runId}) → delivery
//          is receipted on the durable stream → receipt.read flips true on the worker's next
//          turn_started → the worker acknowledges with BLUE.
// Known live gap (receipted, not hidden): the worker→orchestrator reply lane (message.send)
// is admitted at the coordinator event level but has NO scanner grammar in claude-session.mjs
// — a live worker cannot emit it from text. Filed separately.
// Stack: createDriver + BatonApplication + bindBaton (the kg-tiered-loop v3b shape), glm-5.2.
// Usage: node run-live-acceptance.mjs
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bindBaton, createDriver, DEFAULT_RUN_LINEAGE_POLICY } from '../../../../impl/src/index.mjs';
import { BatonApplication } from '../../../../impl/src/application.mjs';
import { GlmSessionCli } from '../../../../impl/src/claude-session.mjs';
import { normalizeGoalPlanPolicy } from '../../../../impl/src/goal-plan.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST } from '../../../../impl/src/worker-policy.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/bidirectional-v3-2026-08-02');
const ATTEMPT = new Date().toISOString();
const SALT = `bd3${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const CANARY = `ZEBRA-QUARTZ-${String(Date.now() % 90_000 + 10_000)}`;
const STATE_ROOT = resolve(repo, '.baton', `bd3-live-${SALT}`);
const repoId = `repo-${SALT}`;
const log = (line) => console.log(`[bd3-live ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const receipts = { attempt: ATTEMPT, salt: SALT, canary: CANARY, repoId, phases: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'live-acceptance-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);

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
log(`assembling the driver stack (repoId ${repoId}, base ${headSha.slice(0, 12)}, canary ${CANARY})`);

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
const coordinator = driver.coordinator;
const eventLog = driver.log;
log('stack assembled — starting the wave');

let wave = null;
let waveRunId = null;
try {
  wave = await baton.waves.start({
    members: [{
      role: 'reader',
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/bidirectional-v3-2026-08-02/**'],
      objective: [
        `[attempt: bd3-live-${ATTEMPT}]`,
        'You are the reader in a BD3 collaboration-spine live acceptance. Your deliverable (FINAL turn only): write docs/reference/evidence/bidirectional-v3-2026-08-02/live-acceptance-worker-report.md with three short sections (The read lane / The message lane / What I verified), grounded in what actually happened.',
        'TURN 1 — analysis only, no file writes. Print TWO wire lines (TEXT you print, never tools you call), one per assistant message. First the progress artifact (it proves your analysis turn is live work):',
        `SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"BD3-A read lane: the wire shape is CONTEXT_READ colon JSON with keys query,expectedFence,idempotencyKey; the query carries no runId or scope — the hub derives them."},"expectedFence":"current","idempotencyKey":"${SALT}-note-1"}`,
        'Then the read itself:',
        `CONTEXT_READ: {"query":{"kind":"knowledge","text":"acceptance canary"},"expectedFence":"current","idempotencyKey":"${SALT}-read-1"}`,
        'The hub answers through a framed nudge naming an acceptance canary phrase of the form WORD-WORD-NUMBER. If the answer arrives WITHOUT such a phrase, continue other work and re-emit the line once with idempotencyKey',
        `"${SALT}-read-2" in a later turn. While you wait, inspect the scanner grammar your line just exercised: grep -an "scanForContextRead" impl/src/claude-session.mjs then sed -n on the region it names (the file contains NUL bytes — never open it whole).`,
        'MID-WORK: the orchestrator will send you a MESSAGE (kind query). It asks you to acknowledge with the word BLUE. Print BLUE in your next assistant message after you see it, and record the exchange in your report.',
        'FINAL TURN ONLY: write the report file — quote the exact canary phrase you received and the framing it arrived in, quote the exact message body the orchestrator sent and how it reached you, then your verification observations. Never invent a canary: if none arrived, say so plainly — an honest miss is a valid acceptance result. Work in ONE continuous flow until the report is complete.',
      ].join(' '),
    }],
  });
  const runHandle = wave.runs.get('reader');
  waveRunId = runHandle?.id ?? null;
  log(`wave started, member run ${waveRunId ?? 'pending'}`);
  receipts.phases.push({ phase: 1, runId: waveRunId });

  // Seed the canary IMMEDIATELY (before the first poll sleep): the run horizon serves
  // node.runId === waveRunId, so this node is in-horizon for the reader's very first read.
  store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed',
    body: `acceptance canary: the acceptance canary phrase is ${CANARY}. This node exists to prove the BD3-A read lane serves run-horizon knowledge to a live worker.`,
    repoId, runId: waveRunId, evidence: [],
  }, { actor: 'orchestrator', key: `bd3-live-canary:${SALT}` });
  receipts.phases.push({ phase: 1.05, canarySeeded: true, runId: waveRunId });
  persist();
  log(`canary seeded under run ${waveRunId}`);

  const deadline = Date.now() + 30 * 60_000;
  let resting = false;
  let dead = null;
  let lastPhase = null;
  let messageId = null;
  const nudgedRequestIds = new Set();
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
        const result = await runHandle.act('nudge_turn', { message: 'Continue to completion: finish the read-lane and message-lane observations and write the report.' })
          .catch((error) => ({ error: String(error?.message ?? error) }));
        log(`steering nudge_turn ${checkpoint.requestId.slice(0, 24)} → ${JSON.stringify(result).slice(0, 120)}`);
      }
    }
    const taskRow = store.snapshot().tasks.find((row) => row.runId === waveRunId);
    const taskStatus = taskRow?.status ?? null;
    // BD3-C: send the query message once the worker is live (assignee present).
    if (messageId == null && taskRow?.assignee) {
      const sent = await coordinator.sendMessage({
        kind: 'query', to: { runId: waveRunId },
        body: 'BD3-C live check: acknowledge by printing the word BLUE in your next assistant message and quote this sentence in your report.',
      }, { actor: 'orchestrator' });
      messageId = sent.messageId ?? null;
      receipts.phases.push({ phase: 1.1, messageSent: sent, messageId });
      persist();
      log(`message sent: ${JSON.stringify(sent).slice(0, 160)}`);
    }
    if (phase !== lastPhase) {
      log(`progress reader phase=${phase ?? '?'} task=${taskStatus ?? '?'} checkpoint=${checkpoint ? checkpoint.requestId.slice(0, 24) : 'none'}`);
      lastPhase = phase;
    }
    if (['work_completed', 'completed', 'result_ready'].includes(phase) && taskStatus === 'completed') {
      resting = true;
    } else if (['cancelled', 'failed'].includes(phase) || ['failed', 'cancelled'].includes(taskStatus)) {
      dead = { phase, taskStatus };
    }
  }
  if (dead) log(`the reader died (${dead.phase}/${dead.taskStatus}) — harvesting partial evidence`);
  if (!resting && !dead) log('the reader never reached a resting state — harvesting partial evidence');
  receipts.phases.push({ phase: 2, resting, dead, runId: waveRunId });
  persist();

  // ---------------------------------------------------------------
  // VERIFICATION — stream truth + receipt truth + result-pin truth.
  // (v1 measurement bugs fixed: the scanner's context.read event lands on the coordinator's
  // intake, NOT the worker log — the worker-log receipt is context.read_result; the worker's
  // report lives in its result pin, not the main checkout; receipt.read stays honestly null
  // for a single-turn completion — it only flips on a post-delivery turn_started.)
  // ---------------------------------------------------------------
  const taskRow = store.snapshot().tasks.find((row) => row.runId === waveRunId && row.assignee)
    ?? store.snapshot().tasks.find((row) => row.runId === waveRunId);
  const workerId = taskRow?.assignee ?? taskRow?.reservedWorkerId ?? null;
  const stream = workerId ? eventLog.read(workerId) : [];
  const readResults = stream.filter((event) => event.kind === 'context.read_result');
  const delivered = stream.filter((event) => event.kind === 'message.delivered');
  const deliveredIndex = stream.findIndex((event) => event.kind === 'message.delivered');
  const postDeliveryTurns = deliveredIndex >= 0
    ? stream.slice(deliveredIndex + 1).filter((event) => event.kind === 'lifecycle.turn_started').length
    : 0;
  const okResults = readResults.filter((event) => event.payload?.ok === true);
  const canaryServed = okResults.some((event) => JSON.stringify(event.payload ?? {}).includes(CANARY));
  const untrustedFramed = okResults.every((event) => JSON.stringify(event.payload ?? {}).includes('UNTRUSTED'));
  const receipt = messageId ? coordinator.messageReceipt(messageId) : null;
  // Receipt honesty: read must be true if a post-delivery turn_started exists; with none
  // (a single-turn completion) null is the honest state — never upgraded to a lie.
  const receiptReadHonest = receipt?.delivered === true
    && (postDeliveryTurns > 0 ? receipt.read === true : receipt.read === null)
    && receipt.actedOn == null;
  // The report lives in the worker's result pin (Baton-Task trailer binds the worktree id).
  const worktreeId = stream.find((event) => event.kind === 'worktree.owner_bound')?.payload?.physicalOwnerId ?? null;
  let report = '';
  let resultSha = null;
  if (worktreeId) {
    try {
      const pins = execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      for (const pin of pins.slice(0, 6)) {
        const message = execFileSync('git', ['log', '-1', '--format=%B', pin], { cwd: repo, encoding: 'utf8' });
        if (!message.includes(`Baton-Task: ${worktreeId}`)) continue;
        resultSha = pin;
        report = execFileSync('git', ['show', `${pin}:docs/reference/evidence/bidirectional-v3-2026-08-02/live-acceptance-worker-report.md`], { cwd: repo, encoding: 'utf8' });
        break;
      }
    } catch { /* pin read is best-effort; the verdict records what was found */ }
  }
  const reportCanary = report.includes(CANARY);
  const reportBlue = /\bBLUE\b/u.test(report);

  const checks = {
    workerId,
    worktreeId,
    resultSha,
    readResults: readResults.length,
    okResults: okResults.length,
    canaryServed,
    untrustedFramed,
    messageId,
    receiptDelivered: receipt?.delivered ?? null,
    receiptRead: receipt?.read ?? null,
    postDeliveryTurns,
    receiptReadHonest,
    deliveredEvents: delivered.length,
    reportFound: report.length > 0,
    reportCanary,
    reportBlue,
  };
  const verdict = resting
    && okResults.length >= 1 && canaryServed && untrustedFramed
    && receiptReadHonest
    && reportCanary && reportBlue
    ? 'BD3-LIVE-OK' : 'BD3-LIVE-INCOMPLETE';
  receipts.phases.push({ phase: 3, checks, verdict });
  persist();
  log(`verdict: ${verdict} — ${JSON.stringify(checks)}`);
} finally {
  persist();
  if (wave) {
    const closedWave = await wave.close({ reason: 'bd3 live acceptance complete' }).catch((error) => ({ error: String(error?.message ?? error) }));
    receipts.phases.push({ phase: 4, waveClosed: true, remainingCount: closedWave?.remainingCount ?? null });
    persist();
  }
  await application.shutdown(principal).catch(() => {});
}
log(receipts.phases.find((phase) => phase.verdict)?.verdict === 'BD3-LIVE-OK' ? 'BD3-LIVE-OK' : 'BD3-LIVE-INCOMPLETE');
