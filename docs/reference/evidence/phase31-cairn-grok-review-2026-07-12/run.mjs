#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CairnRunScorecard, CodexAppServerCli, GlmSessionCli, GrokAcpCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const HARNESS = process.env.BATON_REVIEW_HARNESS ?? 'grok';
if (!['grok', 'codex', 'glm'].includes(HARNESS)) throw new Error(`unsupported BATON_REVIEW_HARNESS ${HARNESS}`);
const AUTH = HARNESS === 'glm' ? resolve(process.env.BATON_GLM_AUTH_FILE ?? 'glm_key.json') : join(homedir(), HARNESS === 'grok' ? '.grok' : '.codex', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-cairn-grok-review-'));
const RUN_ID = `phase31-cairn-${HARNESS}-review`;
const TIMEOUT_MS = Number(process.env.BATON_REVIEW_TIMEOUT_MS ?? 360000);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const GROK_TASKS = [
  { taskId: 'cairn-review-grok45', model: 'grok-4.5', path: 'reviews/dogfood/cairn-review-grok45.md', focus: 'atomic store authority, event attribution, evidence spoofing, artifact integrity, replay, and seal races' },
  { taskId: 'cairn-review-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/cairn-review-composer.md', focus: 'ACI shape, web/MCP run propagation, deterministic metrics, lifecycle/refinement behavior, and missing acceptance tests' },
];
const TASKS = HARNESS === 'grok' ? GROK_TASKS : HARNESS === 'codex' ? [
  { taskId: 'cairn-review-codex-integrity', model: 'gpt-5.6-sol', path: 'reviews/dogfood/cairn-review-codex-integrity.md', focus: GROK_TASKS[0].focus },
  { taskId: 'cairn-review-codex-api', model: 'gpt-5.6-sol', path: 'reviews/dogfood/cairn-review-codex-api.md', focus: GROK_TASKS[1].focus },
] : [
  { taskId: 'cairn-review-glm', model: 'glm-4.7', path: 'reviews/dogfood/cairn-review-glm.md', focus: 'atomic store authority, event attribution, deterministic scorecard derivation, replay, artifact integrity, and lifecycle cleanup' },
];

async function until(fn, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Adversarially review committed Cairn Rung 0 at ${git(['rev-parse', '--short', 'HEAD'])}, focusing on ${task.focus}. Inspect spec/phase31/cairn-run-scorecard.md, impl/src/cairn-run-scorecard.mjs, coordination-store.mjs, coordinator.mjs, index.mjs, web-northbound.mjs, mcp-northbound.mjs, and impl/test/phase31-cairn-scorecard.test.mjs. Try to construct concrete counterexamples. Write ${task.path} with exact headings "## Verdict", "## Contract matrix", "## Actionable findings", and "## Missing regressions".`,
    constraints: [
      `Edit only ${task.path}.`,
      'Use at most 16 repository/tool calls, then finish from collected evidence.',
      'Ground every defect in exact source locations and a reproducible sequence; distinguish a Phase 31 defect from explicitly deferred later Cairn rungs.',
      'Do not edit product code/tests/spec/evidence, commit, push, deploy, use network tools, access homelab, or read credentials.',
      'Keep the report under 3000 words. If no actionable Phase 31 defect remains, say so explicitly.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist and the report gives an evidence-backed closure verdict',
    verification: { command: `test -s ${task.path} && grep -Fq '## Actionable findings' ${task.path} && node --test impl/test/phase31-cairn-scorecard.test.mjs`, expectExit: 0, timeoutMs: 180000 },
    budget: { tokens: 60000, usd: 4, wallMin: 10 },
  });
}

if (!existsSync(AUTH)) throw new Error(`PENDING-LIVE-no-${HARNESS}-auth-file`);
mkdirSync(OUTPUT, { recursive: true });
const adapter = HARNESS === 'grok'
  ? new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 2 })
  : HARNESS === 'codex'
    ? new CodexAppServerCli({ requestTimeoutMs: 30000, ceiling: 2 })
    : new GlmSessionCli({ authTokenFile: AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER, model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '0.40'], ceiling: 1, killGraceMs: 5000 });
const runtimeIsolation = HARNESS === 'glm' ? {} : { credentialFiles: { [HARNESS]: [AUTH] } };
const dependencyDirs = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const { coordinator, coordination, log } = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { [HARNESS]: adapter },
  runtimeIsolation,
  workerDependencyDirs: dependencyDirs, verifyDependencyDirs: dependencyDirs,
  capabilityFactories: { cairn: ({ coordination: store, readOperational }) => new CairnRunScorecard({ coordination: store, readOperational, artifactRoot: join(OUTPUT, 'artifacts') }) },
  maxCapabilityBudgetTokens: 20_000, maxCapabilityEnvelopeBytes: 256 * 1024,
  approvalTimeoutMs: 60000, stopDeadlineMs: 15000, watchdog: { stallMs: TIMEOUT_MS },
});

const rows = []; const approvals = []; const stopResults = []; let pumping = true; let fatal = null; let scorecard = null; let scorecardReverify = null;
function hydrate(row) {
  row.handle = coordinator.list().find((worker) => worker.id === row.workerId) ?? row.handle;
  row.events = log.read(row.workerId);
  row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? row.pid ?? null;
  row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? row.verify ?? null;
  const sha = row.verify?.payload?.capture?.sha;
  if (sha && !row.review) { try { row.review = git(['show', `${sha}:${row.path}`]); } catch (error) { row.reviewCaptureError = String(error?.stack ?? error); } }
}
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      approvals.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped report.' }, 'human') });
    }
    await sleep(100);
  }
})();

try {
  await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(HARNESS, brief(task), {
      taskId: task.taskId, taskType: 'cairn-adversarial-review', runId: RUN_ID,
      model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: [HARNESS === 'grok' ? 'grok' : HARNESS === 'codex' ? 'openai' : 'glm'] },
    });
    rows.push({ ...task, workerId: handle.id, handle });
  }));
  await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of rows) { row.result = await coordinator.result(row.workerId); hydrate(row); }
  if (rows.some((row) => row.result.status !== 'completed')) throw new Error(`review trust gate failed: ${JSON.stringify(rows.map((row) => ({ taskId: row.taskId, status: row.result.status })))}`);
  scorecard = await coordinator.invokeCapability('cairn', 'run.scorecard', { runId: RUN_ID }, { actor: 'orchestrator', budgetTokens: 16_000 });
  writeFileSync(join(OUTPUT, 'scorecard-claim.json'), `${JSON.stringify(scorecard, null, 2)}\n`);
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  for (const row of rows) {
    hydrate(row);
    try { stopResults.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { stopResults.push({ taskId: row.taskId, error: String(error?.stack ?? error) }); }
    hydrate(row);
  }
}

if (scorecard) {
  try { scorecardReverify = await coordinator.reverifyCapability('cairn', 'run.scorecard', scorecard, { runId: RUN_ID }, { actor: 'orchestrator', budgetTokens: 16_000 }); }
  catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
}
try {
  await until(() => rows.every((row) => !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'both reviewers fully reaped', 30000);
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }

for (const row of rows) hydrate(row);
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const sealed = coordination.run(RUN_ID);
const checks = {
  noHarnessError: fatal === null,
  expectedWorkers: rows.length === TASKS.length,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === TASKS.length,
  concurrentTurns: starts.length === TASKS.length && terminals.length === TASKS.length && (TASKS.length < 2 || Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts)))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  exactLowEffortRouted: rows.every((row) => row.handle?.effortRequested === 'low' && row.handle?.effortResolved === 'low'),
  exactRunAttributed: rows.every((row) => row.handle?.runId === RUN_ID && row.events.every((event) => event.taskId === row.taskId && event.runId === RUN_ID)),
  freshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.review?.includes('## Actionable findings')),
  scorecardSealed: scorecard?.status === 'ok' && sealed?.status === 'sealed' && scorecard.payload?.[0]?.tasks?.total === TASKS.length && scorecard.payload?.[0]?.completions?.verified === TASKS.length,
  scorecardReverifiedAfterStops: scorecardReverify?.status === 'ok' && scorecardReverify?.payload?.[0]?.ok === true,
  killsConfirmed: stopResults.length === TASKS.length && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  metadataGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), runId: RUN_ID,
  harness: HARNESS, harnessVersion: HARNESS === 'grok' ? execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim() : adapter.card().version,
  rows: rows.map(({ events, ...row }) => row), approvals, stopResults, scorecard, scorecardReverify, sealed, checks, fatal,
  pass: Object.values(checks).every(Boolean),
};
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ requestedModel: row.model, ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.review) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.review);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved, effort: row.handle?.effortResolved, pid: row.pid })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
