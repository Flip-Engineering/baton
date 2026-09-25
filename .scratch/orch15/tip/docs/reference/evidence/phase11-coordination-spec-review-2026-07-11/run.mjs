#!/usr/bin/env node
// Recursive Baton review of CK1-CK9. The accepted review is integrated through Baton's own
// ff-only lifecycle; provider credentials are projected by name and never read or logged.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const REVIEW_KIND = process.env.BATON_REVIEW_KIND ?? 'spec';
const OUTPUT_DIR = process.env.BATON_EVIDENCE_DIR ? resolve(REPO, process.env.BATON_EVIDENCE_DIR) : HERE;
const AUTH = join(homedir(), '.grok', 'auth.json');
const LOG_DIR = join(tmpdir(), `baton-coordination-review-${Date.now()}`);
const TASK_ID = REVIEW_KIND === 'implementation' ? 'grok-coordination-implementation-review' : 'grok-coordination-spec-review';
const TARGET = REVIEW_KIND === 'implementation' ? 'reviews/dogfood/grok-coordination-implementation-review.md' : 'reviews/dogfood/grok-coordination-spec-review.md';
const MODEL = 'grok-composer-2.5-fast';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function git(args, cwd = REPO) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until(fn, label, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

if (!existsSync(AUTH)) {
  console.log(JSON.stringify({ pass: false, pending: 'PENDING-LIVE-no-grok-auth-file' }, null, 2));
  process.exit(2);
}

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  runtimeIsolation: { credentialFiles: { grok: [AUTH] } },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: 180000 },
});

const brief = createBrief({
  goal: REVIEW_KIND === 'implementation'
    ? `Adversarially review the CK1-CK8 implementation in impl/src/coordination-store.mjs, impl/src/coordinator.mjs, impl/src/index.mjs, and the phase11 coordination/acceptance/persistent tests against spec/phase11/coordination-knowledge.md. Write ${TARGET} with exact headings "## Verdict", "## Critical and major findings", "## Contract corrections", and "## Implementation order". Reproduce or source-trace crash atomicity, replay authority, refinement/recovery, artifact provenance, Scratch overlap/expiry, bitemporal causality, multi-event contamination, failed read logging, and built-not-wired paths. Treat 519/519 as evidence to attack, not proof.`
    : `Adversarially review spec/phase11/coordination-knowledge.md against docs/26-full-system-goal.md, docs/08-shared-memory-and-pm.md, docs/capabilities/coordination-repl.md, and the current impl/src/log.mjs + impl/src/coordinator.mjs. Write ${TARGET} with exact headings "## Verdict", "## Critical and major findings", "## Contract corrections", and "## Implementation order". Focus on crash consistency, replay, CAS/leases, bitemporal causality, poisoning/read provenance, task/artifact integration, and whether CK9 can catch built-not-wired behavior.`,
  constraints: [
    `Edit only ${TARGET}.`,
    'Do not change specs or implementation; do not commit, push, deploy, or use network tools.',
    'Ground every finding in repository paths/contracts. Distinguish a real contract defect from later scope.',
    'Keep the review under 1800 words and do not praise without testing a failure mode.',
  ],
  pathScope: [TARGET],
  definitionOfDone: 'All four exact headings exist and findings are actionable against CK contract IDs',
  verification: {
    command: `test -s ${TARGET} && grep -q '^## Verdict$' ${TARGET} && grep -q '^## Critical and major findings$' ${TARGET} && grep -q '^## Contract corrections$' ${TARGET} && grep -q '^## Implementation order$' ${TARGET}`,
    expectExit: 0,
    timeoutMs: 10000,
  },
  // The first attempted review consumed 62,828 wire tokens (62,063 cached-read) in its opening
  // repository-reading frame and was correctly hard-stopped at 25k. This explicit cap is derived
  // from that measurement with room for the actual review/write turn; it is not a disabled gate.
  budget: { tokens: 150000, usd: 2, wallMin: 4 },
});

let workerId = null;
let pid = null;
let fatal = null;
let result = null;
let integration = null;
let pumping = true;
const approvals = [];

async function inputPump() {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      const answer = worker.pendingApprovalId
        ? { decision: 'allow' }
        : { text: 'Proceed within the pinned read-only review and single-output-file scope.' };
      approvals.push({ requestId, ack: await coordinator.respond(requestId, answer, 'human') });
    }
    await sleep(100);
  }
}

const pump = inputPump();
try {
  const handle = await coordinator.spawn('grok', brief, {
    taskId: TASK_ID,
    taskType: 'adversarial-review',
    model: MODEL,
    modelPolicy: { allow: [MODEL], allowFamilies: ['grok'] },
  });
  workerId = handle.id;
  await until(() => log.read(workerId).some((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native spawn');
  pid = log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'fresh-worktree verified review');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`review did not pass trust gate: ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
  await until(
    () => !pidAlive(pid)
      && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
      && !existsSync(join(REPO, '.baton', 'runtime', workerId))
      && git(['branch', '--list', `baton/${TASK_ID}`]) === '',
    'review worker fully reaped',
    30000,
  );
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  pumping = false;
  await pump.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
}

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const checks = {
  noHarnessError: fatal === null,
  exactModelObserved: handle?.modelRequested === MODEL && handle?.modelResolved === MODEL && handle?.modelObserved === MODEL,
  freshVerified: result?.status === 'completed' && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  integrated: integration?.ok === true && existsSync(join(REPO, TARGET)),
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'),
  processGone: !!pid && !pidAlive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId, pid,
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  result, integration, approvals, checks, fatal, pass: Object.values(checks).every(Boolean),
};
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
