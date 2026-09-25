#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClaudeSessionCli, CodexAppServerCli, GlmSessionCli, GrokAcpCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? resolve(HERE, '../../../..', 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase43-adverse-matrix-'));
const RUN_ID = 'phase43-adverse-harness-matrix';
const ALL_TASKS = [
  { taskId: 'phase43-adverse-claude-review', harness: 'claude', model: 'claude-opus-4-6', family: 'claude' },
  { taskId: 'phase43-adverse-codex-review', harness: 'codex', model: 'gpt-5.6-sol', family: 'openai' },
  { taskId: 'phase43-adverse-glm-review', harness: 'glm', model: 'glm-4.7', family: 'glm' },
  { taskId: 'phase43-adverse-grok-review', harness: 'grok', model: 'grok-4.5', family: 'grok' },
].map((row) => ({ ...row, target: `reviews/dogfood/${row.taskId}.md` }));
const selectedHarnesses = new Set((process.env.BATON_HARNESSES ?? '').split(',').filter(Boolean));
const TASKS = selectedHarnesses.size > 0 ? ALL_TASKS.filter((row) => selectedHarnesses.has(row.harness)) : ALL_TASKS;
const MAX_TOKENS = Number(process.env.BATON_REVIEW_MAX_TOKENS ?? 100_000);
const GLM_MAX_USD = Number(process.env.BATON_GLM_MAX_USD ?? 1);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

async function until(fn, label, timeoutMs = 420_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

function reviewBrief(task) {
  return createBrief({
    goal: `Adversarially review committed Phase 43 seedless adverse-provider transaction ${git(['rev-parse', '--short', 'HEAD'])}. Read spec/phase43/adverse-provider-ingestion.md, impl/src/coordination-store.mjs, impl/src/coordinator.mjs, and impl/test/phase43-provider-reconciliation.test.mjs. Focus on seedless/mixed atomic completion, multi-source grow-only union, repo-scoped bounded fan-out, pending races, causal lineage, replay mutation, and green non-clearance. Write ${task.target} with exactly "## Verdict", "## P0-P1 findings", and "## Required red tests".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Use at most six repository/tool calls and keep the report under 900 words.',
      'Ground every finding in an exact source seam and reproducible event or race.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, access homelab/project-manager, or edit product files.',
      'Distinguish this adverse transaction from still-unshipped polling, explicit cursor recovery, production HTTPS routing, and positive clearance.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'The three exact headings exist and the verdict is explicit',
    verification: { command: `test -s ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required red tests' ${task.target}`, expectExit: 0, timeoutMs: 30_000 },
    budget: { tokens: MAX_TOKENS, usd: task.harness === 'glm' ? GLM_MAX_USD : 2, wallMin: 8 },
  });
}

function bounded(events) {
  const allowed = new Set(['runtime.scope_created', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed', 'lifecycle.crashed', 'resource.tokens', 'resource.budget_threshold', 'verify.reverified', 'kill.requested', 'kill.confirmed']);
  return events.filter((event) => allowed.has(event.kind)).map((event) => ({
    seq: event.seq, ts: event.ts, actor: event.actor, kind: event.kind,
    harnessRequested: event.harnessRequested ?? null, harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null, modelResolved: event.modelResolved ?? null, modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    effortRequested: event.effortRequested ?? null, effortResolved: event.effortResolved ?? null, effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'runtime.scope_created' ? { family: event.payload?.family ?? null, projectedFiles: event.payload?.projectedFiles ?? [], permissions: event.payload?.permissions ?? null }
      : event.kind === 'lifecycle.spawned' ? { pid: event.payload?.pid ?? null, threadId: event.payload?.threadId ?? event.payload?.sessionId ?? null }
        : event.kind === 'resource.tokens' ? { tokens: event.payload?.tokens ?? null, usd: event.payload?.usd ?? null, accounting: event.payload?.accounting ?? null }
          : event.kind === 'verify.reverified' ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, captureSha: event.payload?.capture?.sha ?? null }
            : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind) ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 256) } : {},
  }));
}

if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
if (!existsSync(CODEX_AUTH)) throw new Error('PENDING-LIVE-no-codex-auth');
mkdirSync(OUTPUT, { recursive: true });
const adapters = {
  claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default', ceiling: 1 }),
  codex: new CodexAppServerCli({ requestTimeoutMs: 30_000, ceiling: 1 }),
  glm: new GlmSessionCli({ authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key', model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', GLM_MAX_USD.toFixed(2)], ceiling: 1, killGraceMs: 5_000 }),
  grok: new GrokAcpCli({ requestTimeoutMs: 30_000, ceiling: 1 }),
};
const credentialFiles = { codex: [CODEX_AUTH], ...(existsSync(GROK_AUTH) ? { grok: [GROK_AUTH] } : {}) };
const dependencies = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const driver = createDriver({ repoRoot: REPO, logDir: LOG_DIR, adapters, runtimeIsolation: { credentialFiles }, workerDependencyDirs: dependencies, verifyDependencyDirs: dependencies, approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 360_000 } });
const { coordinator, log } = driver;
const rows = []; const responses = []; const kills = []; let pumping = true; let closed = false; let fatal = null;
const pump = (async () => { const consumed = new Set(); while (pumping) { for (const worker of coordinator.list()) { const id = worker.pendingApprovalId ?? worker.pendingQuestionId; if (!id || consumed.has(id)) continue; consumed.add(id); responses.push({ workerId: worker.id, requestId: id, ack: await coordinator.respond(id, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the bounded review.' }, 'orchestrator') }); } await sleep(100); } })();
try {
  const admitted = await Promise.all(TASKS.map(async (task) => ({ ...task, handle: await coordinator.spawn(task.harness, reviewBrief(task), { taskId: task.taskId, taskType: 'phase43-adverse-review', runId: RUN_ID, model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' } }) })));
  rows.push(...admitted.map((row) => ({ ...row, workerId: row.handle.id })));
  await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} terminal result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId); row.events = log.read(row.workerId); row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null; row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha; if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) { try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; } }
  }
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  for (const row of rows) { row.events ??= log.read(row.workerId); row.pid ??= row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null; try { kills.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }); } catch (error) { kills.push({ taskId: row.taskId, error: String(error?.message ?? error) }); } }
}
try {
  await until(() => rows.every((row) => (!row.pid || !alive(row.pid)) && !existsSync(join(REPO, '.baton', 'wt', row.taskId)) && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`)) && !existsSync(join(REPO, '.baton', 'runtime', row.workerId)) && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'all harness resources reaped', 30_000);
  closed = driver.close();
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
for (const row of rows) { row.events = log.read(row.workerId); row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId)); }
const glm = rows.find((row) => row.harness === 'glm'); const coordinationRoot = join(LOG_DIR, 'coordination');
const checks = {
  runnerHealthy: fatal === null,
  allHarnessesAdmitted: rows.length === TASKS.length,
  allExactRoutesRequested: rows.every((row) => row.handle.harnessRequested === row.harness && row.handle.modelRequested === row.model && row.handle.modelResolved === row.model && row.handle.effortRequested === 'low' && row.handle.effortResolved === 'low'),
  glmCredentialedNativePid: Number.isSafeInteger(glm?.pid) && glm.handle.modelObserved === 'glm-4.7',
  glmFreshVerified: glm?.result?.status === 'completed' && glm.verify?.payload?.accept === true && glm.report?.includes('## Required red tests'),
  allControlSafe: kills.length === TASKS.length && kills.every((row) => ['confirmed', 'forced', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => !row.pid || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
  writerAuthorityReleased: closed === true && !existsSync(join(coordinationRoot, 'writer.lease')) && (!existsSync(coordinationRoot) || !readdirSync(coordinationRoot).some((name) => name.startsWith('writer.claim.'))),
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), runId: RUN_ID, rows: rows.map((row) => ({ taskId: row.taskId, harness: row.harness, model: row.model, workerId: row.workerId, pid: row.pid, result: row.result ? { status: row.result.status, ready: row.result.ready } : null, route: { modelRequested: row.handle.modelRequested, modelResolved: row.handle.modelResolved, modelObserved: row.handle.modelObserved, effortRequested: row.handle.effortRequested, effortResolved: row.handle.effortResolved, effortObserved: row.handle.effortObserved }, budgetUsed: row.handle.budgetUsed, verifyAccept: row.verify?.payload?.accept ?? false, reportCaptured: Boolean(row.report), terminal: row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))?.payload ?? null })), responses, kills, checks, fatal, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events).map((event) => JSON.stringify({ taskId: row.taskId, requestedHarness: row.harness, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, rows: summary.rows, checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
