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
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-ir-scope-review-'));
const TIMEOUT_MS = Number(process.env.BATON_REVIEW_TIMEOUT_MS ?? 360000);
const TASKS = [
  { taskId: 'grok-ir-scope-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-ir-scope-45.md', stance: 'constructive' },
  { taskId: 'grok-ir-scope-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-ir-scope-composer.md', stance: 'adversarial' },
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

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
  const stance = task.stance === 'constructive'
    ? 'Propose the smallest honest R4 vertical worth building now.'
    : 'Try to falsify the premise that an R4 vertical belongs next; recommend redirect or an explicit negative evaluation if that is more honest.';
  return createBrief({
    goal: `Review Baton's intended R4 compiler/intermediate-representation and semantic-delta rung at ${git(['rev-parse', '--short', 'HEAD'])}. Read docs/15-representation-and-computation.md, docs/26-full-system-goal.md, reviews/frontier-features/representation.md, the Phase 18-22 CPG implementation/specs/tests, and current Atlas artifact conventions. ${stance} Resolve whether JavaScript/TypeScript needs a real external compiler IR, a deliberately scoped Baton IR, a language fixture, or a measured negative gate. Do not relabel AST/CPG as compiler IR. Cover value proposition, exact semantics, tool/substrate choice, delta/translation-validation relationship, ACI envelope, artifact schema, bounds/cancellation/resume/tamper/reverify, integration seams, red tests, live Baton-on-Baton proof, honest limitations, and keep/redirect/retire criteria. Write ${task.path} with exact headings "## Decision", "## Proposed numbered contract", "## Red tests and proof", and "## Risks and rejection criteria".`,
    constraints: [
      `Edit only ${task.path}.`,
      'Use at most 12 repository or tool calls, then finish the report from collected evidence.',
      'Ground every proposal in current source or plan text and distinguish existing capability from new work.',
      'No homelab integration or dependency. Do not use network tools, read credentials, edit product code/specs/evidence, commit, push, or deploy.',
      'Keep the report under 2600 words and state one unambiguous next action.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist, the decision is unambiguous, and the proposed contract is falsifiable',
    verification: {
      command: `test -s ${task.path} && grep -Fq '## Proposed numbered contract' ${task.path} && grep -Fq '## Risks and rejection criteria' ${task.path} && cd impl && npm test`,
      expectExit: 0,
      timeoutMs: 180000,
    },
    budget: { tokens: 50000, usd: 4, wallMin: 9 },
  });
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) throw new Error('BATON_REVIEW_TIMEOUT_MS must be positive');
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
  watchdog: { stallMs: TIMEOUT_MS },
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
    try { row.review = git(['show', `${sha}:${row.path}`]); }
    catch (error) { row.reviewCaptureError = String(error?.stack ?? error); }
  }
}

async function stop(row) {
  if (stopped.has(row.workerId)) return;
  stopped.add(row.workerId);
  try { stopResults.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }); }
  catch (error) { stopResults.push({ taskId: row.taskId, error: String(error?.stack ?? error) }); }
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
        ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the bounded report now.' }, 'human'),
      });
    }
    await sleep(100);
  }
})();

try {
  const spawned = await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', brief(task), {
      taskId: task.taskId,
      taskType: 'representation-design-review',
      model: task.model,
      modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    const row = { ...task, workerId: handle.id, handle };
    rows.push(row);
    hydrate(row);
    return row;
  }));
  const waits = await Promise.allSettled(spawned.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of spawned) { row.result = await coordinator.result(row.workerId); hydrate(row); }
  const failures = waits.map((wait, index) => wait.status === 'rejected' ? `${spawned[index].taskId}: ${wait.reason}` : null).filter(Boolean);
  if (failures.length) throw new Error(`review waits failed:\n${failures.join('\n')}`);
  const rejected = spawned.filter((row) => row.result.status !== 'completed');
  if (rejected.length) throw new Error(`review trust gates failed: ${JSON.stringify(rejected.map((row) => ({ taskId: row.taskId, result: row.result })))}`);
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  for (const row of rows) { hydrate(row); await stop(row); hydrate(row); }
}

try {
  await until(() => rows.every((row) =>
    !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''
  ), 'both IR reviewers fully reaped', 30000);
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}

for (const row of rows) hydrate(row);
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const checks = {
  noHarnessError: fatal === null,
  twoReviews: rows.length === 2,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: starts.length === 2 && terminals.length === 2 && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  bothFreshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.review?.includes('## Proposed numbered contract')),
  bothKillsConfirmed: stopResults.length === 2 && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  reviewTimeoutMs: TIMEOUT_MS,
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
console.log(JSON.stringify({ pass: summary.pass, checks, models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
