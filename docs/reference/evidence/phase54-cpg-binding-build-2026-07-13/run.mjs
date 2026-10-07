#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlmSessionCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = resolve(HERE, '../../../..');
const REPO = resolve(process.env.BATON_REPO ?? SOURCE_REPO);
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? join(SOURCE_REPO, 'glm_key.json'));
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase54-build-'));
const BASE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();

function loginCommand(name) {
  const output = execFileSync('/bin/zsh', ['-lic', `whence -p ${name}`], { encoding: 'utf8' });
  const selected = output.split(/\r?\n/u).map((line) => line.match(/(\/[^\u0007\u001b\r\n]+)$/u)?.[1] ?? null).filter(Boolean).at(-1);
  if (!selected || !existsSync(selected)) throw new Error(`login shell did not resolve ${name}`);
  return selected;
}

const CLAUDE_CMD = loginCommand('claude');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const names = (path) => existsSync(path) ? readdirSync(path).sort() : [];
const credentialFact = (path) => { try { const stat = statSync(path); return { present: stat.isFile(), ownerOnly: (stat.mode & 0o077) === 0 }; } catch { return { present: false, ownerOnly: false }; } };

async function until(fn, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(50); }
  throw new Error(`timeout waiting for ${label}`);
}

function ownership() {
  return {
    worktrees: git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).sort(),
    branches: git(['branch', '--list', 'baton/*']).split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    worktreeEntries: names(join(REPO, '.baton', 'wt')),
    runtimeEntries: names(join(REPO, '.baton', 'runtime')),
  };
}

if (git(['status', '--porcelain']) !== '') throw new Error('Phase 54 build target must be clean');
if (!existsSync(GLM_AUTH)) throw new Error('project GLM credential file is missing');
if (!existsSync(join(REPO, 'impl', 'node_modules'))) throw new Error('clean target lacks an isolated impl/node_modules projection');
mkdirSync(OUTPUT, { recursive: true });
for (const file of ['events.jsonl', 'summary.json']) rmSync(join(OUTPUT, file), { force: true });

const before = ownership();
const adapter = new GlmSessionCli({
  cmd: CLAUDE_CMD,
  authTokenFile: GLM_AUTH,
  authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
  model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits',
  args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '3.5'],
  ceiling: 1, killGraceMs: 5_000,
});
const driver = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { glm: adapter },
  workerDependencyDirs: ['impl/node_modules'], verifyDependencyDirs: ['impl/node_modules'],
  approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 600_000 },
});
const { coordinator, log } = driver;
const taskId = process.env.BATON_TASK_ID ?? 'phase54-glm-build';
const verification = 'node --test impl/test/phase54-atlas-cpg-lexical-bindings.test.mjs impl/test/phase18-atlas-cpg.test.mjs impl/test/phase19-atlas-cpg-delta.test.mjs impl/test/phase20-atlas-cpg-taint.test.mjs impl/test/phase22-atlas-cpg-path-sensitive.test.mjs';
const brief = createBrief({
  goal: `Implement committed Baton Phase 54 at ${BASE_SHA.slice(0, 12)}. Read spec/phase54/atlas-cpg-lexical-bindings.md and make the committed red suite pass by adding bounded lexical scope/binding identity to the existing CPG, delta, and taint implementation.`,
  constraints: [
    'Edit only impl/src/atlas-cpg.mjs, impl/src/atlas-cpg-delta.mjs, and impl/src/atlas-cpg-taint.mjs.',
    'Do not weaken, delete, skip, or edit tests or the specification.',
    'Preserve every explicit non-goal and do not add edit, merge, verification, routing, or publication authority.',
    'Use the existing ast-grep dependency. Do not inspect credentials/environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    'Run the focused verification before finishing and keep the implementation deterministic and bounded.',
  ],
  pathScope: ['impl/src/atlas-cpg.mjs', 'impl/src/atlas-cpg-delta.mjs', 'impl/src/atlas-cpg-taint.mjs'],
  definitionOfDone: 'All Phase 54 and adjacent Phase 18/19/20/22 tests pass without changing the tests.',
  verification: { command: verification, expectExit: 0, timeoutMs: 120_000 },
  budget: { tokens: 220_000, usd: 3.5, wallMin: 30 },
});

let handle; let result; let verify; let processStarted; let processClosed; let killFloor = 0; let killAck = null; let fatal = null; let closed = false;
const responses = [];
let pumping = true;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (requestId && !consumed.has(requestId)) {
        consumed.add(requestId);
        responses.push({ requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish only the scoped Phase 54 implementation.' }, 'orchestrator') });
      }
    }
    await sleep(25);
  }
})();

try {
  handle = await coordinator.spawn('glm', brief, {
    taskId, taskType: 'phase54-cpg-binding-implementation', runId: 'phase54-cpg-binding-build',
    model: 'glm-4.7', effort: 'low', modelPolicy: { allow: ['glm-4.7'], allowFamilies: ['glm'], reasoningEffort: 'low' },
  });
  await until(async () => (await coordinator.result(handle.id)).ready, 'Phase 54 GLM result');
  result = await coordinator.result(handle.id);
  const events = log.read(handle.id); verify = events.findLast((event) => event.kind === 'verify.reverified') ?? null;
  processStarted = events.find((event) => event.kind === 'lifecycle.process_started' && event.actor === 'worker') ?? null;
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  if (handle) {
    const events = log.read(handle.id); killFloor = events.at(-1)?.seq ?? 0;
    try { killAck = await coordinator.kill(handle.id, 'policy'); } catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
  }
}

try {
  if (handle) await until(() => {
    const events = log.read(handle.id); processClosed = events.find((event) => event.kind === 'lifecycle.process_closed' && event.actor === 'worker') ?? null;
    const pid = processStarted?.payload?.pid;
    return (!pid || (!alive(pid) && !groupAlive(pid))) && !existsSync(join(REPO, '.baton', 'wt', taskId)) && !existsSync(join(REPO, '.baton', 'runtime', handle.id)) && git(['branch', '--list', `baton/${taskId}`]) === '';
  }, 'Phase 54 process and ownership reap', 45_000);
  closed = driver.close();
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }

const events = handle ? log.read(handle.id) : [];
const publicHandle = handle ? coordinator._publicHandle(coordinator._workers.get(handle.id)) : null;
const killRequested = events.find((event) => event.seq > killFloor && event.kind === 'kill.requested') ?? null;
const killConfirmed = events.find((event) => event.seq > (killRequested?.seq ?? Number.MAX_SAFE_INTEGER) && event.kind === 'kill.confirmed') ?? null;
const captureSha = verify?.payload?.capture?.sha ?? null;
const tuple = (() => { try { return JSON.parse(publicHandle?.routeKey); } catch { return null; } })();
const exactRoute = Array.isArray(tuple) && publicHandle?.harnessRequested === 'glm'
  && tuple[0] === String(publicHandle?.harnessResolved ?? '').split('@')[0]
  && tuple[2] === 'glm-4.7' && tuple[3] === 'low' && tuple[4] === 'glm' && tuple[5] === 'phase54-cpg-binding-implementation';
const after = ownership();
const cleanup = {
  leaderGone: !processStarted?.payload?.pid || !alive(processStarted.payload.pid),
  groupGone: !processStarted?.payload?.processGroupId || !groupAlive(processStarted.payload.processGroupId),
  taskWorktreeGone: !existsSync(join(REPO, '.baton', 'wt', taskId)),
  runtimeGone: !handle || !existsSync(join(REPO, '.baton', 'runtime', handle.id)),
  taskBranchGone: git(['branch', '--list', `baton/${taskId}`]) === '',
  ownershipRestored: JSON.stringify(before) === JSON.stringify(after),
  writerReleased: closed && !existsSync(join(LOG_DIR, 'coordination', 'writer.lease')),
};
const buildPass = fatal === null && result?.status === 'completed' && verify?.payload?.accept === true && captureSha && exactRoute && Object.values(cleanup).every(Boolean);
const summary = {
  at: new Date().toISOString(), baseSha: BASE_SHA, repoHead: git(['rev-parse', 'HEAD']), buildPass, fatal,
  credential: credentialFact(GLM_AUTH),
  route: publicHandle ? { harnessRequested: publicHandle.harnessRequested, harnessResolved: publicHandle.harnessResolved, modelRequested: publicHandle.modelRequested, modelResolved: publicHandle.modelResolved, modelObserved: publicHandle.modelObserved, effortRequested: publicHandle.effortRequested, effortResolved: publicHandle.effortResolved, effortObserved: publicHandle.effortObserved, routeKey: publicHandle.routeKey, exact: exactRoute } : null,
  result: result ? { ready: result.ready, status: result.status } : null,
  budgetUsed: publicHandle?.budgetUsed ?? null, captureSha, verifyAccept: verify?.payload?.accept ?? false,
  processStarted: processStarted?.payload ?? null, processClosed: processClosed?.payload ?? null,
  kill: { ack: killAck, requestedSeq: killRequested?.seq ?? null, confirmedSeq: killConfirmed?.seq ?? null }, responses, cleanup,
};
const kept = new Set(['runtime.scope_created', 'lifecycle.process_started', 'lifecycle.process_ready', 'lifecycle.spawned', 'lifecycle.turn_started', 'resource.tokens', 'lifecycle.turn_completed', 'verify.reverified', 'kill.requested', 'kill.confirmed', 'lifecycle.process_closed', 'control.forced_stop', 'lifecycle.crashed']);
writeFileSync(join(OUTPUT, 'events.jsonl'), `${events.filter((event) => kept.has(event.kind)).map((event) => JSON.stringify(event)).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (fatal === null) rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify(summary, null, 2));
if (!buildPass) process.exitCode = 1;
