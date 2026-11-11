#!/usr/bin/env node
// Provider-backed PS1-PS8 proof: two independently verified public turns on one exact Grok
// session/process, followed by confirmed kill and complete worktree/branch reap.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const LOG_DIR = join(tmpdir(), `baton-grok-persistent-${Date.now()}`);
const TASK_ID = 'grok-persistent-session-proof';
const MODEL = 'grok-composer-2.5-fast';
const TARGET = 'reviews/dogfood/grok-persistent-session-proof.md';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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

const brief = createBrief({
  goal: `Read spec/phase11/persistent-sessions.md, then create ${TARGET} with a short factual note about Baton's persistent-session safety boundary and a final line exactly "turn=1".`,
  constraints: [
    `Edit only ${TARGET}.`,
    'Do not commit, push, deploy, use network access, or change implementation/specification files.',
    'Keep the note under 180 words.',
  ],
  pathScope: [TARGET],
  definitionOfDone: `${TARGET} exists and its final line is a valid turn marker`,
  verification: { command: `test -s ${TARGET} && grep -Eq '^turn=(1|2)$' ${TARGET}`, expectExit: 0, timeoutMs: 10000 },
  budget: { tokens: 9000, usd: 1, wallMin: 3 },
});

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
});

const approvals = [];
let workerId = null;
let pid = null;
let fatal = null;
let stopResult = null;
let pumping = true;
let first = null;
let second = null;
let firstHandle = null;
let secondHandle = null;
let followUpAck = null;
let finalContent = null;

async function inputPump() {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      const answer = worker.pendingApprovalId
        ? { decision: 'allow' }
        : { text: 'Proceed exactly within the pinned path and verification scope.' };
      approvals.push({ worker: worker.id, requestId, ack: await coordinator.respond(requestId, answer, 'human') });
    }
    await sleep(100);
  }
}

const pumpPromise = inputPump();
try {
  const handle = await coordinator.spawn('grok', brief, {
    taskId: TASK_ID,
    taskType: 'persistent-session-proof',
    model: MODEL,
    modelPolicy: { allow: [MODEL], allowFamilies: ['grok'] },
  });
  workerId = handle.id;

  await until(async () => (await coordinator.result(workerId)).ready, 'first verified turn');
  first = await coordinator.result(workerId);
  firstHandle = coordinator.list().find((worker) => worker.id === workerId);
  const firstEvents = log.read(workerId);
  pid = firstEvents.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;

  followUpAck = await coordinator.send(
    workerId,
    `Re-read ${TARGET}. Preserve its factual note, add one sentence explaining that this is a second public Baton turn on the same session, and replace the final line exactly with "turn=2". Edit no other file.`,
    'turn',
  );
  if (!followUpAck.ok) throw new Error(`follow-up refused: ${JSON.stringify(followUpAck)}`);

  await until(async () => {
    const result = await coordinator.result(workerId);
    return result.ready && log.read(workerId).filter((event) => event.kind === 'verify.reverified').length === 2;
  }, 'second independently verified turn');
  second = await coordinator.result(workerId);
  secondHandle = coordinator.list().find((worker) => worker.id === workerId);
  const verifies = log.read(workerId).filter((event) => event.kind === 'verify.reverified');
  const finalSha = verifies.at(-1)?.payload?.capture?.sha;
  if (finalSha) finalContent = git(['show', `${finalSha}:${TARGET}`]);

  stopResult = await coordinator.kill(workerId, 'policy');
  await until(
    () => !pidAlive(pid)
      && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
      && !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`))
      && git(['branch', '--list', `baton/${TASK_ID}`]) === '',
    'persistent worker fully reaped',
    30000,
  );
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  pumping = false;
  await pumpPromise.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
}

const events = workerId ? log.read(workerId) : [];
const workerSpawns = events.filter((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker');
const verifies = events.filter((event) => event.kind === 'verify.reverified');
const turnStarts = events.filter((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker');
const checks = {
  noHarnessError: fatal === null,
  followUpAccepted: followUpAck?.ok === true,
  firstFreshVerified: first?.status === 'completed' && verifies[0]?.payload?.accept === true,
  secondFreshVerified: second?.status === 'completed' && verifies[1]?.payload?.accept === true,
  twoIndependentVerifications: verifies.length === 2 && new Set(verifies.map((event) => event.payload?.capture?.sha)).size === 2,
  twoWorkerTurns: turnStarts.length === 2,
  oneNativeSpawn: workerSpawns.length === 1,
  sameSessionRef: !!firstHandle?.sessionRef && JSON.stringify(firstHandle.sessionRef) === JSON.stringify(secondHandle?.sessionRef),
  samePid: !!pid && new Set(workerSpawns.map((event) => event.payload?.pid)).size === 1,
  exactModelObserved: secondHandle?.modelRequested === MODEL && secondHandle?.modelResolved === MODEL && secondHandle?.modelObserved === MODEL,
  finalTurnMarker: finalContent?.split('\n').at(-1) === 'turn=2',
  killConfirmed: ['confirmed', 'already_dead'].includes(stopResult?.result),
  processGone: !!pid && !pidAlive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  metadataGone: !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`)),
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  taskId: TASK_ID,
  workerId,
  pid,
  first,
  second,
  firstHandle,
  secondHandle,
  followUpAck,
  approvals,
  stopResult,
  verifyCaptures: verifies.map((event) => event.payload?.capture),
  finalContent,
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, checks, sessionRef: secondHandle?.sessionRef, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
