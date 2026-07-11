#!/usr/bin/env node
// Real-vendor phase-10 capstone. This spends vendor quota and must run only after SC20 passes.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriver, createBrief, ClaudeSessionCli, CodexAppServerCli, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const RUN_ID = `phase10.1-${Date.now()}`;
const LOG_DIR = join(tmpdir(), `baton-${RUN_ID}-log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function version(cmd) {
  try { return execFileSync(cmd, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; }
}

function makeBrief({ goal, path, verification }) {
  return createBrief({
    goal,
    constraints: [
      `Edit only ${path}.`,
      'Base every claim on files in this checkout; do not use network access.',
      'Do not commit, push, or modify task/spec state.',
    ],
    pathScope: [path],
    definitionOfDone: `${path} exists, is substantive, and the pinned verification passes`,
    verification: { command: verification, expectExit: 0, timeoutMs: 120000 },
    budget: { tokens: 30000, usd: 2, wallMin: 8 },
  });
}

const adapters = {
  claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default' }),
  codex: new CodexAppServerCli({ requestTimeoutMs: 30000 }),
  grok: new GrokAcpCli({ requestTimeoutMs: 30000 }),
};
const { coordinator, log, story } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters,
  approvalTimeoutMs: 120000,
  stopDeadlineMs: 20000,
});

const taskDefs = [
  {
    vendor: 'claude', taskId: 'dogfood-claude-validation', taskType: 'review',
    path: 'reviews/dogfood/claude-validation-review.md',
    goal: 'Inspect impl/VALIDATION.md, docs/24-goal-system-completion.md, spec/phase10.1/spawn-stop-reconciliation.md, and the phase10.1 evidence. Write reviews/dogfood/claude-validation-review.md: a concise evidence-grounded list of validation claims that must change after phase 10.1, followed by a live-capstone acceptance checklist. Start by reading the cited files before writing.',
    verification: "test -s reviews/dogfood/claude-validation-review.md && grep -qi 'phase 10.1' reviews/dogfood/claude-validation-review.md",
  },
  {
    vendor: 'codex', taskId: 'dogfood-codex-capability-gap', taskType: 'review',
    path: 'reviews/dogfood/codex-capability-gap-review.md',
    goal: 'Inspect docs/handoff/evidence/capability-matrix.json and docs/handoff/ISSUE-001-phase10-handoff.md section 6. Write reviews/dogfood/codex-capability-gap-review.md: verify the shipped/fenced/debt counts, identify the three highest-priority UNSHIPPED-DEBT clusters, and explicitly keep phase-11 implementation out of this task.',
    verification: "test -s reviews/dogfood/codex-capability-gap-review.md && grep -q 'UNSHIPPED-DEBT' reviews/dogfood/codex-capability-gap-review.md",
  },
  {
    vendor: 'grok', taskId: 'dogfood-grok-contract-audit', taskType: 'review',
    path: 'reviews/dogfood/grok-sc12-audit.md',
    goal: 'Inspect spec/phase10.1/spawn-stop-reconciliation.md and impl/test/phase10.1-reconciliation.test.mjs. Write reviews/dogfood/grok-sc12-audit.md: map SC12 through SC20 to concrete tests, call out any remaining coverage concern, and distinguish the session product tier from legacy one-shot adapters.',
    verification: "test -s reviews/dogfood/grok-sc12-audit.md && grep -q 'SC12' reviews/dogfood/grok-sc12-audit.md",
  },
  {
    vendor: 'codex', taskId: 'dogfood-codex-interrupt', taskType: 'review',
    path: 'reviews/dogfood/interrupted-full-source-review.md',
    goal: 'Perform a deliberately broad source audit: inspect every file under impl/src one by one, take detailed notes, then write reviews/dogfood/interrupted-full-source-review.md. Do not skip files. This task is intentionally long-running so the coordinator can exercise a real mid-turn interrupt.',
    verification: 'test -s reviews/dogfood/interrupted-full-source-review.md',
    interruptTarget: true,
  },
];

const handles = [];
const actions = { approvals: [], questions: [], steer: null, interrupt: null };
let pump = true;
const consumed = new Set();

async function inputPump() {
  while (pump) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      if (worker.pendingApprovalId) {
        const ack = await coordinator.respond(requestId, { decision: 'allow' }, 'human');
        actions.approvals.push({ worker: worker.id, requestId, ok: ack.ok === true });
      } else {
        const ack = await coordinator.respond(requestId, { text: 'Proceed with the scoped evidence-grounded task as written.' }, 'human');
        actions.questions.push({ worker: worker.id, requestId, ok: ack.ok === true });
      }
    }
    await sleep(100);
  }
}

async function waitForEvent(workerId, predicate, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = log.read(workerId).find(predicate);
    if (hit) return hit;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label} on ${workerId}; kinds=${log.read(workerId).map((e) => e.kind).join(',')}`);
}

async function waitForTerminal(workerId, timeoutMs = 480000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await coordinator.result(workerId);
    if (last.ready) return last;
    await sleep(250);
  }
  throw new Error(`timeout waiting for terminal result on ${workerId}; last=${JSON.stringify(last)}`);
}

let fatal = null;
let results = [];
const pumpPromise = inputPump();

try {
  const spawned = await Promise.all(taskDefs.map(async (task) => {
    const h = await coordinator.spawn(task.vendor, makeBrief(task), { taskId: task.taskId, taskType: task.taskType });
    handles.push({ ...h, ...task });
    return { ...h, ...task };
  }));

  const claude = spawned.find((h) => h.vendor === 'claude');
  const interrupted = spawned.find((h) => h.interruptTarget);

  await Promise.all([
    (async () => {
      await waitForEvent(claude.id, (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker', 'Claude worker turn start');
      actions.steer = await coordinator.send(
        claude.id,
        'Steer: also include a heading named "Recursive dogfood implications" and explicitly separate shipped session behavior from phase-11 governance debt.',
        'steer',
      );
    })(),
    (async () => {
      await waitForEvent(interrupted.id, (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker', 'Codex interrupt-target turn start');
      await sleep(750);
      actions.interrupt = await coordinator.interrupt(interrupted.id, undefined, 'human');
    })(),
  ]);

  results = await Promise.all(spawned.map(async (h) => ({
    workerId: h.id,
    vendor: h.vendor,
    taskId: h.taskId,
    interruptTarget: !!h.interruptTarget,
    result: await waitForTerminal(h.id),
  })));
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  pump = false;
  await pumpPromise.catch(() => {});
  for (const h of handles) {
    await Promise.resolve(coordinator.kill(h.id, 'policy')).catch(() => {});
  }
}

const allEvents = handles.flatMap((h) => log.read(h.id).map((e) => ({ taskId: h.taskId, vendor: h.vendor, ...e })));
const completionRows = results.filter((r) => !r.interruptTarget);
const interruptedRow = results.find((r) => r.interruptTarget);
const starts = completionRows.map((r) => allEvents.find((e) => e.worker === r.workerId && e.kind === 'lifecycle.turn_started' && e.actor === 'worker')).filter(Boolean);
const firstTerminals = completionRows.map((r) => allEvents.find((e) => e.worker === r.workerId && ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(e.kind))).filter(Boolean);
const overlapped = starts.length === completionRows.length && firstTerminals.length === completionRows.length
  && Math.max(...starts.map((e) => Date.parse(e.ts))) <= Math.min(...firstTerminals.map((e) => Date.parse(e.ts)));

const summary = {
  runId: RUN_ID,
  at: new Date().toISOString(),
  repoHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
  versions: { claude: version('claude'), codex: version('codex'), grok: version('grok') },
  glm: (process.env.Z_AI_API_KEY || process.env.ZHIPU_API_KEY) ? 'credential-present-not-run' : 'PENDING-LIVE-no-credential',
  actions,
  results,
  concurrency: { overlapped, workerStarts: starts.map((e) => ({ worker: e.worker, ts: e.ts })) },
  story: story.narrative(),
  fatal,
};

const verifyEvents = new Map(allEvents.filter((e) => e.kind === 'verify.reverified').map((e) => [e.worker, e]));
const checks = {
  noHarnessError: fatal === null,
  threeVendorsCompleted: completionRows.length === 3 && completionRows.every((r) => r.result.status === 'completed'),
  everyCompletionTrustGated: completionRows.length === 3 && completionRows.every((r) => verifyEvents.get(r.workerId)?.payload?.accept === true),
  steerLanded: actions.steer?.ok === true && allEvents.some((e) => e.worker === handles.find((h) => h.vendor === 'claude')?.id && e.kind === 'control.steer'),
  interruptLanded: actions.interrupt?.result === 'confirmed' && interruptedRow?.result?.status === 'cancelled',
  approvalExercised: actions.approvals.some((a) => a.ok),
  vendorsOverlapped: overlapped,
};
summary.checks = checks;
summary.pass = Object.values(checks).every(Boolean);

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), allEvents.map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(JSON.stringify({ pass: summary.pass, checks, results: results.map((r) => ({ taskId: r.taskId, vendor: r.vendor, status: r.result.status })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
