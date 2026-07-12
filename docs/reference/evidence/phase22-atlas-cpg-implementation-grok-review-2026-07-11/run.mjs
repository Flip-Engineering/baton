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
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-cpg-impl-review-'));
const REVIEW_TIMEOUT_MS = Number(process.env.BATON_REVIEW_TIMEOUT_MS ?? 300000);
const REVIEW_FOCUS = process.env.BATON_REVIEW_FOCUS?.trim() ?? '';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const ALL_TASKS = [
  { taskId: 'grok-cpg-impl-review-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-cpg-impl-review-45.md' },
  { taskId: 'grok-cpg-impl-review-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-cpg-impl-review-composer.md' },
];
const TASKS = process.env.BATON_REVIEW_MODEL
  ? ALL_TASKS.filter((task) => task.model === process.env.BATON_REVIEW_MODEL)
  : ALL_TASKS;

if (!TASKS.length) throw new Error(`unknown BATON_REVIEW_MODEL: ${process.env.BATON_REVIEW_MODEL}`);
if (!Number.isFinite(REVIEW_TIMEOUT_MS) || REVIEW_TIMEOUT_MS <= 0) throw new Error('BATON_REVIEW_TIMEOUT_MS must be positive');

async function until(fn, label, timeoutMs = REVIEW_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  const focus = REVIEW_FOCUS ? ` Focus this closure pass: ${REVIEW_FOCUS}` : '';
  return createBrief({
    goal: `Adversarially review committed Phase 22 PS1-PS8 at ${git(['rev-parse', '--short', 'HEAD'])}. Inspect spec/phase22/atlas-cpg-path-sensitive.md, impl/src/atlas-cpg.mjs, atlas-cpg-delta.mjs, atlas-cpg-taint.mjs, and Phase 18-22 tests. Try to falsify structured-if CFG, joins, literal pruning, unsupported-control atomic collapse, CFG may-reaching-def fixed point and bound, statement anchoring, direct copy/argument semantics, sanitizer cuts, artifact schema/resume/reverify, delta compatibility, and claim language.${focus} Write ${task.path} with exact headings "## Verdict", "## Contract matrix", "## Actionable findings", and "## Missing regressions".`,
    constraints: [
      `Edit only ${task.path}.`,
      'Ground findings in exact source locations and failure sequences; distinguish product gaps from PS1-PS8 defects.',
      'Use at most 10 repository or tool calls, then finish the focused report with the evidence already collected.',
      'Do not edit implementation/tests/specs/evidence, commit, push, deploy, access homelab, use network tools, or read credentials.',
      'Keep the report under 2400 words. If no actionable defect remains, say so explicitly.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist and every PS1-PS8 seam has an evidence-backed verdict',
    verification: {
      command: `test -s ${task.path} && grep -Fq '## Actionable findings' ${task.path} && node --test impl/test/phase18-atlas-cpg.test.mjs impl/test/phase19-atlas-cpg-delta.test.mjs impl/test/phase20-atlas-cpg-taint.test.mjs impl/test/phase22-atlas-cpg-path-sensitive.test.mjs`,
      expectExit: 0,
      timeoutMs: 180000,
    },
    budget: { tokens: 60000, usd: 4, wallMin: 10 },
  });
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: TASKS.length });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  runtimeIsolation: { credentialFiles: { grok: [AUTH] } },
  workerDependencyDirs: ['impl/node_modules'],
  verifyDependencyDirs: ['impl/node_modules'],
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: REVIEW_TIMEOUT_MS },
});

const rows = [];
const approvals = [];
const stopResults = [];
const stopped = new Set();
let pumping = true;
let fatal = null;

function hydrate(row) {
  row.handle = coordinator.list().find((worker) => worker.id === row.workerId) ?? row.handle;
  row.events = log.read(row.workerId);
  row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? row.pid ?? null;
  row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? row.verify ?? null;
  const sha = row.verify?.payload?.capture?.sha;
  if (sha && !row.review) {
    try {
      row.review = git(['show', `${sha}:${row.path}`]);
    } catch (error) {
      row.reviewCaptureError = String(error?.stack ?? error);
    }
  }
}

async function stop(row) {
  if (stopped.has(row.workerId)) return;
  stopped.add(row.workerId);
  try {
    stopResults.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') });
  } catch (error) {
    stopResults.push({ taskId: row.taskId, error: String(error?.stack ?? error) });
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
        workerId: worker.id,
        requestId,
        ack: await coordinator.respond(
          requestId,
          worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped adversarial report.' },
          'human',
        ),
      });
    }
    await sleep(100);
  }
})();

try {
  const spawned = await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', brief(task), {
      taskId: task.taskId,
      taskType: 'adversarial-implementation-review',
      model: task.model,
      modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    const row = { ...task, workerId: handle.id, handle };
    rows.push(row);
    hydrate(row);
    return row;
  }));

  const waits = await Promise.allSettled(spawned.map((row) => until(
    async () => (await coordinator.result(row.workerId)).ready,
    `${row.taskId} verified result`,
  )));

  for (const row of spawned) {
    row.result = await coordinator.result(row.workerId);
    hydrate(row);
  }

  const waitFailures = waits
    .map((wait, index) => wait.status === 'rejected' ? `${spawned[index].taskId}: ${wait.reason}` : null)
    .filter(Boolean);
  if (waitFailures.length) throw new Error(`review waits failed:\n${waitFailures.join('\n')}`);

  const trustFailures = spawned.filter((row) => row.result.status !== 'completed');
  if (trustFailures.length) {
    throw new Error(`review trust gates failed: ${JSON.stringify(trustFailures.map((row) => ({ taskId: row.taskId, result: row.result })))}`);
  }
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  for (const row of rows) {
    hydrate(row);
    await stop(row);
    hydrate(row);
  }
}

try {
  await until(() => rows.every((row) =>
    !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''
  ), 'selected implementation reviewers fully reaped', 30000);
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}

for (const row of rows) hydrate(row);
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const lifecycleComplete = starts.length === TASKS.length && terminals.length === TASKS.length;
const checks = {
  noHarnessError: fatal === null,
  expectedReviews: rows.length === TASKS.length,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === TASKS.length,
  concurrentTurns: lifecycleComplete && (TASKS.length < 2 || Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts)))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  freshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.review?.includes('## Actionable findings')),
  killsConfirmed: stopResults.length === TASKS.length && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  selectedModels: TASKS.map((task) => task.model),
  reviewTimeoutMs: REVIEW_TIMEOUT_MS,
  reviewFocus: REVIEW_FOCUS || null,
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  rows: rows.map(({ events, ...row }) => row),
  approvals,
  stopResults,
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ taskId: row.taskId, requestedModel: row.model, ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({
  pass: summary.pass,
  checks,
  models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved })),
  fatal,
}, null, 2));
if (!summary.pass) process.exitCode = 1;
