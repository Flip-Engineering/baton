#!/usr/bin/env node
// Provider-backed MS1-MS5 proof: two exact Grok models concurrently, then confirmed reap.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const LOG_DIR = join(tmpdir(), `baton-grok-model-proof-${Date.now()}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const TASKS = [
  { taskId: 'grok-model-proof-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-model-proof-45.md' },
  { taskId: 'grok-model-proof-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-model-proof-composer.md' },
];

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(fn, label, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function taskBrief(task) {
  return createBrief({
    goal: `Read GLOSSARY.md, then write ${task.path} with exactly two short paragraphs: identify the Baton concept you found most important and state the exact model identifier you were assigned (${task.model}).`,
    constraints: [
      `Edit only ${task.path}.`,
      'Do not commit, push, deploy, use network access, or change implementation files.',
      'Keep the result under 180 words.',
    ],
    pathScope: [task.path],
    definitionOfDone: `${task.path} exists and names ${task.model}`,
    verification: { command: `test -s ${task.path} && grep -Fq '${task.model}' ${task.path}`, expectExit: 0, timeoutMs: 10000 },
    budget: { tokens: 8000, usd: 1, wallMin: 3 },
  });
}

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 2 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
});

const handles = [];
const approvals = [];
const stopResults = [];
let pumping = true;
let fatal = null;

async function inputPump() {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      const answer = worker.pendingApprovalId
        ? { decision: 'allow' }
        : { text: 'Proceed exactly within the assigned scope.' };
      approvals.push({ worker: worker.id, requestId, ack: await coordinator.respond(requestId, answer, 'human') });
    }
    await sleep(100);
  }
}

const pumpPromise = inputPump();
try {
  const spawned = await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', taskBrief(task), {
      taskId: task.taskId,
      taskType: 'model-proof',
      model: task.model,
      modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    const row = { ...task, workerId: handle.id };
    handles.push(row);
    return row;
  }));

  await Promise.all(spawned.map((row) => until(
    async () => (await coordinator.result(row.workerId)).ready,
    `${row.taskId} terminal result`,
  )));

  for (const row of spawned) {
    const handle = coordinator.list().find((w) => w.id === row.workerId);
    const result = await coordinator.result(row.workerId);
    row.result = result;
    row.handle = handle;
    row.pid = log.read(row.workerId).find((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker')?.payload?.pid ?? null;
    row.verify = log.read(row.workerId).find((e) => e.kind === 'verify.reverified') ?? null;
    if (row.verify?.payload?.capture?.sha) {
      row.commitMessage = git(['show', '-s', '--format=%B', row.verify.payload.capture.sha]);
    }
  }

  const stopped = await Promise.all(spawned.map(async (row) => ({
    taskId: row.taskId,
    ack: await coordinator.kill(row.workerId, 'policy'),
  })));
  stopResults.push(...stopped);

  await until(
    () => spawned.every((row) => !pidAlive(row.pid)
      && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
      && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
      && git(['branch', '--list', `baton/${row.taskId}`]) === ''),
    'both exact-model workers fully reaped',
    30000,
  );
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  pumping = false;
  await pumpPromise.catch(() => {});
  for (const row of handles) await Promise.resolve(coordinator.kill(row.workerId, 'policy')).catch(() => {});
}

const events = handles.flatMap((row) => log.read(row.workerId).map((event) => ({ taskId: row.taskId, requestedModel: row.model, ...event })));
const starts = handles.map((row) => events.find((e) => e.worker === row.workerId && e.kind === 'lifecycle.turn_started' && e.actor === 'worker')).filter(Boolean);
const terminals = handles.map((row) => events.find((e) => e.worker === row.workerId && ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(e.kind))).filter(Boolean);
const overlapped = starts.length === TASKS.length && terminals.length === TASKS.length
  && Math.max(...starts.map((e) => Date.parse(e.ts))) <= Math.min(...terminals.map((e) => Date.parse(e.ts)));

const checks = {
  noHarnessError: fatal === null,
  twoWorkers: handles.length === 2,
  distinctLivePids: new Set(handles.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: overlapped,
  exactModelsObserved: handles.every((row) => row.handle?.modelRequested === row.model
    && row.handle?.modelResolved === row.model
    && row.handle?.modelObserved === row.model),
  bothFreshVerified: handles.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  modelTrailers: handles.every((row) => row.commitMessage?.includes(`Baton-Model: ${row.model}`)),
  noModelMismatch: events.every((e) => e.kind !== 'model.mismatch'),
  bothKillsConfirmed: stopResults.length === 2 && stopResults.every((row) => row.ack?.result === 'confirmed' || row.ack?.result === 'already_dead'),
  allProcessesGone: handles.every((row) => row.pid && !pidAlive(row.pid)),
  allWorktreesGone: handles.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  allMetadataGone: handles.every((row) => !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))),
  allBranchesGone: handles.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  handles,
  approvals,
  stopResults,
  concurrency: { overlapped, starts: starts.map((e) => ({ worker: e.worker, ts: e.ts })) },
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, checks, models: handles.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved, status: row.result?.status })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
