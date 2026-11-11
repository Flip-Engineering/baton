#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const AUTH = join(homedir(), '.grok', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase39-scope-'));
const RUN_ID = 'phase39-advisory-invalidation-scope';
const TIMEOUT_MS = Number(process.env.BATON_REVIEW_TIMEOUT_MS ?? 360000);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const TASKS = [
  {
    taskId: 'phase39-grok45-safety', model: 'grok-4.5',
    path: 'reviews/dogfood/phase39-grok45-safety.md',
    focus: 'authority, source authenticity, advisory/TTL trigger semantics, fail-closed policy, and explicit non-authority',
  },
  {
    taskId: 'phase39-composer-replay', model: 'grok-composer-2.5-fast',
    path: 'reviews/dogfood/phase39-composer-replay.md',
    focus: 'atomicity, idempotency, replay validation, CAS races, affected-reader contamination, and replacement after invalidation',
  },
];

async function until(fn, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Design and adversarially scope Baton's Phase 39 advisory/TTL invalidation of promoted reuse decisions at committed HEAD ${git(['rev-parse', '--short', 'HEAD'])}, focusing on ${task.focus}. Inspect Phase 36-38 specs, implementation, tests, orientation/reuse docs, and the existing bitemporal knowledge machinery. Write ${task.path} with exact headings "## Verdict", "## Threat model", "## Numbered contract proposal", and "## Red tests". Identify current Phase 38 defects separately from the smallest honest Phase 39 increment.`,
    constraints: [
      `Edit only ${task.path}.`,
      'Use at most 18 repository/tool calls, then finish from collected evidence.',
      'Ground findings in exact source locations and reproducible event sequences; do not invent push infrastructure or provider guarantees.',
      'Preserve the conservative rule that reachability never waives a known advisory and expiration cannot silently refresh evidence.',
      'The phase must not install, mutate lockfiles/code, merge, verify, publish, override policy, export to project-manager, or integrate with homelab.',
      'Do not edit product code/tests/spec/evidence, commit, push, deploy, use network tools, or read credentials.',
      'Keep the report under 2800 words and propose deterministic bounded acceptance tests.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist and the report gives a bounded implementable contract plus adversarial red tests',
    verification: { command: `test -s ${task.path} && grep -Fq '## Numbered contract proposal' ${task.path} && grep -Fq '## Red tests' ${task.path}`, expectExit: 0, timeoutMs: 10000 },
    budget: { tokens: 60000, usd: 4, wallMin: 10 },
  });
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
mkdirSync(OUTPUT, { recursive: true });
const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 2 });
const dependencyDirs = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const { coordinator, log } = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { grok: adapter },
  runtimeIsolation: { credentialFiles: { grok: [AUTH] } },
  workerDependencyDirs: dependencyDirs, verifyDependencyDirs: dependencyDirs,
  approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  budgetPolicy: { terminalGraceMs: 2000 }, watchdog: { stallMs: TIMEOUT_MS },
});

const rows = []; const approvals = []; const stopResults = [];
let pumping = true; let fatal = null;
function hydrate(row) {
  row.handle = coordinator.list().find((worker) => worker.id === row.workerId) ?? row.handle;
  row.events = log.read(row.workerId);
  row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? row.pid ?? null;
  row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? row.verify ?? null;
  const sha = row.verify?.payload?.capture?.sha;
  if (sha && !row.review) {
    try { row.review = git(['show', `${sha}:${row.path}`]); }
    catch (error) { row.reviewCaptureError = String(error?.stack ?? error); }
  }
}
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      approvals.push({
        workerId: worker.id, requestId,
        ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped report.' }, 'human'),
      });
    }
    await sleep(100);
  }
})();

try {
  await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', brief(task), {
      taskId: task.taskId, taskType: 'phase39-adversarial-scope', runId: RUN_ID,
      model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    rows.push({ ...task, workerId: handle.id, handle });
  }));
  await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId); hydrate(row);
    if (row.result.status !== 'completed') throw new Error(`${row.taskId} trust gate failed: ${JSON.stringify(row.result)}`);
  }
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
const checks = {
  noHarnessError: fatal === null,
  twoWorkers: rows.length === 2,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: starts.length === 2 && terminals.length === 2 && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  exactLowEffortRouted: rows.every((row) => row.handle?.effortRequested === 'low' && row.handle?.effortResolved === 'low'),
  exactRunAttributed: rows.every((row) => row.handle?.runId === RUN_ID && row.events.every((event) => event.taskId === row.taskId && event.runId === RUN_ID)),
  freshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.review?.includes('## Numbered contract proposal') && row.review?.includes('## Red tests')),
  killsConfirmed: stopResults.length === 2 && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  metadataGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), runId: RUN_ID,
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  rows: rows.map(({ events, ...row }) => row), approvals, stopResults, checks, fatal,
  pass: Object.values(checks).every(Boolean),
};
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ requestedModel: row.model, ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.review) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.review);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({
  pass: summary.pass, checks,
  models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved, effort: row.handle?.effortResolved, pid: row.pid })),
  fatal,
}, null, 2));
if (!summary.pass) process.exitCode = 1;
