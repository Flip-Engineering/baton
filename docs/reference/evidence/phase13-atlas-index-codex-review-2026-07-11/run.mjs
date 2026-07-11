#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServerCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '../../../..');
const LOG_DIR = join(tmpdir(), `baton-atlas-review-${Date.now()}`); const AUTH = join(homedir(), '.codex', 'auth.json');
const TASK_ID = 'codex-atlas-index-review'; const TARGET = 'reviews/dogfood/codex-atlas-index-review.md'; const MODEL = 'gpt-5.4';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, label, timeoutMs = 360000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error(`timeout waiting for ${label}`); }
if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-codex-auth-file');

const adapter = new CodexAppServerCli({ requestTimeoutMs: 30000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { codex: adapter }, runtimeIsolation: { credentialFiles: { codex: [AUTH] } },
  approvalTimeoutMs: 60000, stopDeadlineMs: 15000, budgetPolicy: { terminalGraceMs: 2000 }, watchdog: { stallMs: 180000 },
});
const brief = createBrief({
  goal: `Adversarially review commit 0819c8d's Atlas shared index/symbol/SCIP implementation against spec/phase13/atlas-index-symbols.md and spec/capability-plane.md. Inspect impl/src/atlas-index.mjs and impl/test/phase13-atlas-index.test.mjs. Write ${TARGET} with exact headings "## Verdict", "## Contract matrix", "## Remaining major findings", and "## Required next actions". Try to falsify content-addressed epoch and artifact integrity, explicit epoch selection, base-plus-overlay confinement and non-mutation, staleness truth, lexical/symbol/reference/call honesty, SCIP interchange claims, token bounds/cursor progress, cancellation, reverify, tamper handling, and the claim AT9-AT16 is green. Separate later live-LSP/semantic/CPG product work from current-gate defects.`,
  constraints: [
    `Edit only ${TARGET}.`, 'Do not modify implementation, tests, specs, task state, or evidence files.',
    'Do not commit, push, deploy, or use network tools.', 'Ground every finding in exact repository paths and classify critical, major, minor, or no finding.',
    'Keep the review under 1800 words and do not accept green tests as sufficient evidence.',
    'Use at most 8 repository-read/tool calls. Once enough evidence is available, stop exploring and write the review.',
  ],
  pathScope: [TARGET], definitionOfDone: 'The four exact headings exist and the review explicitly evaluates AT9-AT16',
  verification: { command: `test -s ${TARGET} && grep -q '^## Verdict$' ${TARGET} && grep -q '^## Contract matrix$' ${TARGET} && grep -q '^## Remaining major findings$' ${TARGET} && grep -q '^## Required next actions$' ${TARGET} && grep -q 'AT9' ${TARGET}`, expectExit: 0, timeoutMs: 10000 },
  budget: { tokens: 350000, usd: 3, wallMin: 5 },
});

let workerId = null; let pid = null; let result = null; let integration = null; let fatal = null; let pumping = true; let synthesisSteer = null;
const approvals = [];
async function inputPump() {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue; consumed.add(requestId);
      const answer = worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Proceed within the pinned review-only scope.' };
      approvals.push({ requestId, response: await coordinator.respond(requestId, answer, 'human') });
    }
    if (workerId && !synthesisSteer && log.read(workerId).filter((event) => event.kind === 'content.tool_call').length >= 6) {
      synthesisSteer = await coordinator.send(workerId, `Tool-count steer: stop further exploration. Write ${TARGET} now from collected evidence, then run only the pinned verification command.`, 'steer', { actor: 'orchestrator' });
    }
    await sleep(100);
  }
}
const pump = inputPump();
try {
  const handle = await coordinator.spawn('codex', brief, { taskId: TASK_ID, taskType: 'adversarial-review', model: MODEL, modelPolicy: { allow: [MODEL], allowFamilies: ['openai'], reasoningEffort: 'low' } });
  workerId = handle.id; const spawned = await until(() => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native Codex spawn'); pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'verified review'); result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`review failed trust gate: ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
  await until(() => pid && !pidAlive(pid) && !existsSync(join(REPO, '.baton', 'wt', TASK_ID)) && !existsSync(join(REPO, '.baton', 'runtime', workerId)) && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'full reap', 30000);
} catch (error) { fatal = String(error?.stack ?? error); } finally { pumping = false; await pump.catch(() => {}); if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {}); }

const events = workerId ? log.read(workerId) : []; const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const checks = {
  noHarnessError: fatal === null, exactModelObserved: handle?.modelRequested === MODEL && handle?.modelResolved === MODEL && handle?.modelObserved === MODEL,
  freshVerified: result?.status === 'completed' && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  integrated: integration?.ok === true && existsSync(join(REPO, TARGET)), integrationIntent: events.some((event) => event.kind === 'integration.completed'),
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'), processGone: !!pid && !pidAlive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)), runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId, pid, model: MODEL, result, integration, approvals, synthesisSteer, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(HERE, { recursive: true }); writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '')); writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2)); if (!summary.pass) process.exitCode = 1;
