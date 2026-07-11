#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServerCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const AUTH = join(homedir(), '.codex', 'auth.json');
const LOG_DIR = join(tmpdir(), `baton-route-tuple-build-${Date.now()}`);
const TASK_ID = 'codex-route-tuple-build';
const MODEL = 'gpt-5.6-sol';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, label, timeout = 900_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-codex-auth-file');
const adapter = new CodexAppServerCli({ requestTimeoutMs: 30_000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { codex: adapter },
  runtimeIsolation: { credentialFiles: { codex: [AUTH] } },
  workerDependencyDirs: ['impl/node_modules'], verifyDependencyDirs: ['impl/node_modules'],
  approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000,
  budgetPolicy: { terminalGraceMs: 2_000 }, watchdog: { stallMs: 300_000 },
});
const TARGETS = [
  'impl/src/route-tuple.mjs', 'impl/src/coordinator.mjs', 'impl/src/index.mjs',
  'impl/src/worktree.mjs', 'impl/src/web-northbound.mjs', 'impl/src/story.mjs',
  'impl/src/adapter.mjs', 'impl/src/codex-appserver.mjs', 'impl/src/claude-session.mjs',
  'impl/src/grok-acp.mjs', 'impl/test/phase14-route-tuple.test.mjs',
  'impl/test/phase11-model-selection.test.mjs', 'impl/test/phase12-web-northbound.test.mjs',
  'impl/test/worktree.test.mjs', 'impl/test/codex-appserver.test.mjs',
  'impl/test/claude-session.test.mjs', 'impl/test/grok-acp.test.mjs',
  'impl/test/fixtures/fake-codex-appserver.mjs', 'impl/test/fixtures/fake-claude.mjs',
  'impl/test/fixtures/fake-grok-acp.mjs',
];
const brief = createBrief({
  goal: 'Implement spec/phase14/harness-model-effort-routing.md RT1-RT11 as a complete deterministic vertical. Add top-level effort to Coordinator and strict web spawn; normalize compatibility with modelPolicy.reasoningEffort and reject conflicts before allocation; resolve model+effort per harness candidate; make assembled adaptive candidate and verified-outcome keys use the identical stable resolved tuple; expose harness/model/effort requested-resolved-observed fields through handles, events, results, replay, story, review and verification; add effort mismatch fail+two-phase-stop; add Baton-Effort commit trailers; and prove Codex/Claude/Grok native mapping. Preserve existing APIs and tests while adding red-first route-tuple coverage.',
  constraints: [
    `Edit only: ${TARGETS.join(', ')}.`,
    'Use Node built-ins only; no new dependencies.',
    'Keep legacy modelPolicy.reasoningEffort behavior, but top-level effort is canonical and conflict fails before allocation.',
    'Do not silently infer effortObserved from effortRequested; only adapter/native metadata may establish observation.',
    'Candidate scoring and verified outcome recording must use the same resolved harness/model/effort key; do not key learning by observed aliases.',
    'Low and high effort for one harness/model/task type must be distinct router buckets.',
    'Preserve ordinary confirmed kill/reap for model or effort mismatch and never verify a mismatched task.',
    'Preserve all web authentication, CORS, CSRF, idempotency, fence, sandbox and trust-gate behavior.',
    'Do not add homelab/deployment integration.',
    'Do not commit, push, or use network tools.',
    'Ground every behavior in spec/phase14/harness-model-effort-routing.md.',
  ],
  pathScope: TARGETS,
  definitionOfDone: 'Red-first tests prove all RT11 cases, exact effort reaches native fake-backed wires, full requested/resolved/observed attribution and replay survive, tuple learning is symmetric and effort-specific, web parity is strict, mismatch stops, and commit trailers include effort',
  verification: {
    command: 'node --test impl/test/phase14-route-tuple.test.mjs impl/test/phase11-model-selection.test.mjs impl/test/phase12-web-northbound.test.mjs impl/test/worktree.test.mjs impl/test/codex-appserver.test.mjs impl/test/claude-session.test.mjs impl/test/grok-acp.test.mjs',
    expectExit: 0, timeoutMs: 180_000,
  },
  budget: { tokens: 900_000, usd: 6, wallMin: 14 },
});

let workerId = null; let pid = null; let result = null; let integration = null;
let fatal = null; let pumping = true; let steer = null; const approvals = [];
const pump = (async () => {
  const seen = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const id = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      approvals.push({ id, response: await coordinator.respond(id, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Proceed within the pinned route-tuple implementation scope.' }, 'human') });
    }
    if (workerId && !steer && log.read(workerId).some((event) => event.kind === 'resource.budget_threshold' && event.payload?.threshold >= 0.8)) {
      steer = await coordinator.send(workerId, 'Budget steer: stop broad exploration, finish RT11 tests and scoped implementation, run the pinned verification, then return.', 'steer', { actor: 'orchestrator' });
    }
    await sleep(100);
  }
})();

try {
  const handle = await coordinator.spawn('codex', brief, {
    taskId: TASK_ID, taskType: 'implementation', model: MODEL, effort: 'low',
    modelPolicy: { allow: [MODEL], allowFamilies: ['openai'], reasoningEffort: 'low' },
  });
  workerId = handle.id;
  const spawned = await until(() => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native spawn');
  pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'verified route tuple');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`route tuple failed trust gate: ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false; await pump.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
  if (workerId) {
    try {
      await until(() => (!pid || !alive(pid))
        && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
        && !existsSync(join(REPO, '.baton', 'runtime', workerId))
        && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'full reap', 30_000);
    } catch (error) { fatal = `${fatal ?? ''}\ncleanup:${error?.stack ?? error}`.trim(); }
  }
}

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const checks = {
  noHarnessError: fatal === null,
  exactTupleResolved: handle?.modelRequested === MODEL && handle?.modelResolved === MODEL
    && handle?.modelObserved === MODEL && handle?.effortRequested === 'low'
    && handle?.effortResolved === 'low' && [null, 'low'].includes(handle?.effortObserved ?? null),
  nativeEffortWire: events.some((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'
    && (event.payload?.reasoningEffort === 'low' || event.payload?.effortObserved === 'low')),
  freshVerified: result?.status === 'completed' && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  integrated: integration?.ok === true, integrationIntent: events.some((event) => event.kind === 'integration.completed'),
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'), processGone: !!pid && !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId, pid, model: MODEL, effort: 'low', result, integration, approvals, steer, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
