#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const AUTH = join(homedir(), '.grok', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase42-grok-kill-reap-'));
const GROK_MODELS = execFileSync('grok', ['models'], { encoding: 'utf8' }).trim();
const TASKS = [
  { taskId: 'phase42-grok45-writer-audit', model: 'grok-4.5', focus: 'writer claims, lifetime lease, replay validation, bounded target derivation, and close/drain safety' },
  { taskId: 'phase42-grokbuild-causal-audit', model: 'grok-composer-2.5-fast', focus: 'policy-card pinning, adverse non-clearance, causal Constraint lineage, and authenticated web/MCP replay' },
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
async function until(fn, label, timeoutMs = 240_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error(`timeout waiting for ${label}`); }
function earlyFailure(handle, wanted) { const events = log.read(handle.id); const found = events.find((event) => event.kind === wanted && event.actor === 'worker'); if (found) return found; const failed = events.find((event) => event.kind === 'lifecycle.crashed'); if (failed) throw new Error(`${handle.id} crashed before ${wanted}: ${JSON.stringify(failed.payload)}`); return null; }
function brief(task) { return createBrief({
  goal: `Continuously red-team Phase 42 at committed HEAD, focusing on ${task.focus}. Inspect spec/phase42/policy-hash-invalidation.md, its implementation, and tests. Remain in the active analysis turn until the orchestrator kills you; do not edit or finish voluntarily.`,
  constraints: ['Read-only analysis only.', 'Do not edit, commit, push, deploy, use homelab, inspect project-manager, or access unrelated credentials.', 'Do not return a final answer; continue inspecting until killed.'],
  pathScope: [], definitionOfDone: 'The orchestrator explicitly kills the still-working review turn.',
  verification: { command: 'true', expectExit: 0, timeoutMs: 10_000 }, budget: { tokens: 50_000, usd: 3, wallMin: 5 },
}); }

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
mkdirSync(OUTPUT, { recursive: true });
const adapter = new GrokAcpCli({ requestTimeoutMs: 30_000, ceiling: 2 });
const driver = createDriver({ repoRoot: REPO, logDir: LOG_DIR, adapters: { grok: adapter }, runtimeIsolation: { credentialFiles: { grok: [AUTH] } }, approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 300_000 } });
const { coordinator, log } = driver;
const rows = []; let handles = []; let killAcks = []; let idempotentKills = []; const cleanupKills = []; let fatal = null; let closed = false;
try {
  handles = await Promise.all(TASKS.map(async (task) => ({ task, handle: await coordinator.spawn('grok', brief(task), { taskId: task.taskId, taskType: 'phase42-live-redteam', model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: ['grok'] } }) })));
  for (const item of handles) {
    const spawned = await until(() => earlyFailure(item.handle, 'lifecycle.spawned'), `${item.task.taskId} native spawn`);
    await until(() => earlyFailure(item.handle, 'lifecycle.turn_started'), `${item.task.taskId} active turn`);
    await until(() => coordinator.list().find((worker) => worker.id === item.handle.id)?.modelObserved === item.task.model, `${item.task.taskId} exact observed model`);
    rows.push({ ...item.task, workerId: item.handle.id, pid: spawned.payload?.pid ?? null, beforeKill: coordinator.list().find((worker) => worker.id === item.handle.id) });
  }
  killAcks = await Promise.all(rows.map((row) => coordinator.kill(row.workerId, 'orchestrator')));
  idempotentKills = await Promise.all(rows.map((row) => coordinator.kill(row.workerId, 'orchestrator')));
  await until(() => rows.every((row) => (row.pid == null || !alive(row.pid)) && !existsSync(join(REPO, '.baton', 'wt', row.taskId)) && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`)) && !existsSync(join(REPO, '.baton', 'runtime', row.workerId)) && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'both Grok workers fully reaped', 30_000);
  closed = driver.close();
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  for (const item of handles) { try { cleanupKills.push({ workerId: item.handle.id, ack: await coordinator.kill(item.handle.id, 'policy') }); } catch (error) { cleanupKills.push({ workerId: item.handle.id, error: String(error?.stack ?? error) }); } }
  if (!closed) { try { closed = driver.close(); } catch (error) { fatal = [fatal, `close:${error?.stack ?? error}`].filter(Boolean).join('\n'); } }
}
for (const item of handles) if (!rows.some((row) => row.workerId === item.handle.id)) { const spawned = log.read(item.handle.id).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'); rows.push({ ...item.task, workerId: item.handle.id, pid: spawned?.payload?.pid ?? null, beforeKill: null }); }
for (const row of rows) { row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId)); row.events = log.read(row.workerId); }
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const stops = rows.map((row) => row.events.find((event) => event.kind === 'kill.confirmed')).filter(Boolean);
const coordinationRoot = join(LOG_DIR, 'coordination');
const checks = {
  noHarnessError: fatal === null,
  grokAuthenticated: !GROK_MODELS.includes('You are not authenticated.'),
  twoWorkers: rows.length === 2,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: starts.length === 2 && stops.length === 2 && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...stops.map((event) => Date.parse(event.ts))),
  routesRequestedResolvedExactly: rows.every((row) => row.handle.modelRequested === row.model && row.handle.modelResolved === row.model && row.handle.effortRequested === 'low' && row.handle.effortResolved === 'low'),
  providerIdentityObserved: rows.every((row) => row.handle.modelObserved === row.model && row.handle.effortObserved === null),
  bothWorkingBeforeKill: rows.every((row) => row.beforeKill?.status === 'working'),
  killConfirmed: killAcks.length === 2 && killAcks.every((ack) => ['confirmed', 'forced'].includes(ack?.result)),
  repeatKillIdempotent: idempotentKills.length === 2 && idempotentKills.every((ack) => ack?.result === 'already_dead'),
  refusalCleanupControlSafe: cleanupKills.length === 2 && cleanupKills.every((row) => ['already_dead', 'confirmed', 'forced'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId)) && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
  writerAuthorityReleased: closed === true && !existsSync(join(coordinationRoot, 'writer.lease')) && (!existsSync(coordinationRoot) || !readdirSync(coordinationRoot).some((name) => name.startsWith('writer.claim.'))),
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(), authProbe: { authenticated: !GROK_MODELS.includes('You are not authenticated.'), output: GROK_MODELS }, rows: rows.map(({ events, ...row }) => row), control: { killAcks, idempotentKills, cleanupKills, closed }, checks, fatal, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ taskId: row.taskId, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, routes: rows.map((row) => ({ requestedModel: row.model, observedModel: row.handle.modelObserved, requestedEffort: row.handle.effortRequested, resolvedEffort: row.handle.effortResolved, observedEffort: row.handle.effortObserved, pid: row.pid })), checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
