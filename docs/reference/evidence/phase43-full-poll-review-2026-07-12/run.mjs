#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlmSessionCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? resolve(HERE, '../../../..', 'glm_key.json'));
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase43-full-poll-review-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const TASK_ID = process.env.BATON_TASK_ID ?? 'phase43-full-poll-glm-review';
const TARGET = `reviews/dogfood/${TASK_ID}.md`;
const RUN_ID = process.env.BATON_RUN_ID ?? 'phase43-full-poll-review';
const REVIEW_GOAL = process.env.BATON_REVIEW_GOAL ?? `Adversarially review committed Phase 43 authenticated full-poll recovery ${git(['rev-parse', '--short', 'HEAD'])}. Read spec/phase43/full-poll-reconciliation.md, impl/src/advisory-feed-registry.mjs, impl/src/coordination-store.mjs, impl/src/coordinator.mjs, and the phase43 provider tests. Evaluate proof binding, sequence completeness, durable receipt admission, recovery CAS races and replay, cancellation, bounds, secret confinement, and whether claims exceed implemented PF1-PF5.`;
const REVIEW_BOUNDARY = process.env.BATON_REVIEW_BOUNDARY ?? 'Distinguish implemented manual PF1-PF5 from unimplemented scheduler/close-drain, production HTTPS adapter, and authenticated bounded reads.';
const MAX_TOKENS = Number(process.env.BATON_REVIEW_MAX_TOKENS ?? 150_000);
const MAX_USD = Number(process.env.BATON_GLM_MAX_USD ?? 1.25);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(fn, label, timeoutMs = 480_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

function brief() {
  return createBrief({
    goal: `${REVIEW_GOAL} Write ${TARGET} with exactly "## Verdict", "## P0-P1 findings", and "## Required red tests".`,
    constraints: [
      `Edit only ${TARGET}.`,
      'Use at most eight repository or tool calls and keep the report under 1,000 words.',
      'Ground every finding in an exact source seam and reproducible event, mutation, or race.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, access homelab/project-manager, or edit product files.',
      REVIEW_BOUNDARY,
    ],
    pathScope: [TARGET],
    definitionOfDone: 'The three exact headings exist and the verdict is explicit.',
    verification: { command: `test -s ${TARGET} && grep -Fq '## P0-P1 findings' ${TARGET} && grep -Fq '## Required red tests' ${TARGET}`, expectExit: 0, timeoutMs: 30_000 },
    budget: { tokens: MAX_TOKENS, usd: MAX_USD, wallMin: 9 },
  });
}

function bounded(events) {
  const allowed = new Set(['runtime.scope_created', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed', 'lifecycle.crashed', 'resource.tokens', 'resource.budget_threshold', 'verify.reverified', 'kill.requested', 'kill.confirmed']);
  return events.filter((event) => allowed.has(event.kind)).map((event) => ({
    seq: event.seq, ts: event.ts, actor: event.actor, kind: event.kind,
    harnessRequested: event.harnessRequested ?? null, harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null,
    modelResolved: event.modelResolved ?? null, modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    effortRequested: event.effortRequested ?? null, effortResolved: event.effortResolved ?? null, effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'runtime.scope_created' ? { family: event.payload?.family ?? null, projectedFiles: event.payload?.projectedFiles ?? [], permissions: event.payload?.permissions ?? null }
      : event.kind === 'lifecycle.spawned' ? { pid: event.payload?.pid ?? null, threadId: event.payload?.threadId ?? event.payload?.sessionId ?? null }
        : event.kind === 'resource.tokens' ? { tokens: event.payload?.tokens ?? null, usd: event.payload?.usd ?? null, accounting: event.payload?.accounting ?? null }
          : event.kind === 'verify.reverified' ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, captureSha: event.payload?.capture?.sha ?? null }
            : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind) ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 256) } : {},
  }));
}

if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
mkdirSync(OUTPUT, { recursive: true });
const adapter = new GlmSessionCli({
  authTokenFile: GLM_AUTH,
  authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
  model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits',
  args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', MAX_USD.toFixed(2)],
  ceiling: 1, killGraceMs: 5_000,
});
const driver = createDriver({ repoRoot: REPO, logDir: LOG_DIR, adapters: { glm: adapter }, approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 420_000 } });
const { coordinator, log } = driver;
let handle; let result; let report = null; let pid = null; let verify = null; let kill = null; let closed = false; let fatal = null; let pumping = true;
const pump = (async () => { const consumed = new Set(); while (pumping) { for (const worker of coordinator.list()) { const id = worker.pendingApprovalId ?? worker.pendingQuestionId; if (!id || consumed.has(id)) continue; consumed.add(id); await coordinator.respond(id, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the bounded review.' }, 'orchestrator'); } await sleep(100); } })();
try {
  handle = await coordinator.spawn('glm', brief(), { taskId: TASK_ID, taskType: 'phase43-full-poll-review', runId: RUN_ID, model: 'glm-4.7', effort: 'low', modelPolicy: { allow: ['glm-4.7'], allowFamilies: ['glm'], reasoningEffort: 'low' } });
  await until(async () => (await coordinator.result(handle.id)).ready, 'GLM terminal result');
  result = await coordinator.result(handle.id);
  const events = log.read(handle.id); pid = events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null; verify = events.find((event) => event.kind === 'verify.reverified') ?? null;
  const sha = verify?.payload?.capture?.sha;
  if (result.status === 'completed' && verify?.payload?.accept === true && sha) report = git(['show', `${sha}:${TARGET}`]);
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  if (handle) { try { kill = await coordinator.kill(handle.id, 'policy'); } catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); } }
}
try {
  await until(() => (!pid || !alive(pid)) && !existsSync(join(REPO, '.baton', 'wt', TASK_ID)) && !existsSync(join(REPO, '.baton', 'runtime', handle?.id ?? '')) && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'GLM resources reaped', 30_000);
  closed = driver.close();
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
const events = handle ? log.read(handle.id) : [];
const route = handle ? coordinator._publicHandle(coordinator._workers.get(handle.id)) : null;
const checks = {
  runnerHealthy: fatal === null,
  exactRoute: route?.harnessRequested === 'glm' && route?.modelRequested === 'glm-4.7' && route?.modelResolved === 'glm-4.7' && route?.modelObserved === 'glm-4.7' && route?.effortRequested === 'low' && route?.effortResolved === 'low',
  credentialedNativePid: Number.isSafeInteger(pid),
  freshVerified: result?.status === 'completed' && verify?.payload?.accept === true && report?.includes('## Required red tests'),
  killSafe: ['confirmed', 'forced', 'already_dead'].includes(kill?.result),
  processGone: !pid || !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: !existsSync(join(REPO, '.baton', 'runtime', handle?.id ?? '')),
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
  writerAuthorityReleased: closed === true,
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), runId: RUN_ID, taskId: TASK_ID, workerId: handle?.id ?? null, pid, result: result ? { status: result.status, ready: result.ready } : null, route: route ? { harnessRequested: route.harnessRequested, harnessResolved: route.harnessResolved, modelRequested: route.modelRequested, modelResolved: route.modelResolved, modelObserved: route.modelObserved, effortRequested: route.effortRequested, effortResolved: route.effortResolved, effortObserved: route.effortObserved } : null, budgetUsed: route?.budgetUsed ?? null, verifyAccept: verify?.payload?.accept ?? false, reportCaptured: Boolean(report), kill, checks, fatal, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(OUTPUT, 'events.jsonl'), `${bounded(events).map((event) => JSON.stringify({ taskId: TASK_ID, requestedHarness: 'glm', requestedModel: 'glm-4.7', requestedEffort: 'low', ...event })).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (report) writeFileSync(join(OUTPUT, `${TASK_ID}.md`), report);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, summary }, null, 2));
if (!summary.pass) process.exitCode = 1;
