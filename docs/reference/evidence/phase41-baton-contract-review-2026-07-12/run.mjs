#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexAppServerCli, GlmSessionCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.BATON_REPO ?? resolve(here, '../../../..'));
const output = resolve(process.env.BATON_EVIDENCE_DIR ?? here);
const glmAuth = resolve(process.env.BATON_GLM_AUTH_FILE ?? 'glm_key.json');
const codexAuth = join(homedir(), '.codex', 'auth.json');
const logDir = mkdtempSync(join(tmpdir(), 'baton-phase41-contract-review-'));
const runId = 'phase41-contract-review';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const tasks = [
  {
    taskId: 'phase41-review-codex', harness: 'codex', model: 'gpt-5.6-sol',
    target: 'reviews/dogfood/phase41-contract-review-codex.md',
    focus: 'actual/proposed source binding, OSV batch completeness, artifact/replay semantics, and ACI authority',
  },
  {
    taskId: 'phase41-review-glm', harness: 'glm', model: 'glm-4.7',
    target: 'reviews/dogfood/phase41-contract-review-glm.md',
    focus: 'negative reachability semantics, nested component ambiguity, fail-closed tests, and backlog non-disappearance',
  },
];

async function until(fn, label, timeoutMs = 360_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Adversarially review committed Phase 41 at ${git(['rev-parse', '--short', 'HEAD'])}, focusing on ${task.focus}. Read spec/phase41/transitive-advisory-projection.md, spec/phase36/quartermaster-external-dossier.md, spec/phase37/lockfile-sbom.md, spec/phase39/advisory-ttl-invalidation.md, spec/phase40/proposed-install-graph.md, impl/src/supply-chain-oracle.mjs, impl/src/cartographer-quartermaster.mjs, and impl/src/atlas-index.mjs. Write ${task.target} with exactly "## Verdict", "## P1-P2 findings", and "## Missing red tests".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Use at most 14 repository/tool calls and keep the report under 2200 words.',
      'Ground every finding in an exact contract or source seam and a reproducible sequence.',
      'Treat absent import/CPG evidence as non-clearance; never propose vulnerable-function proof without release/export identity.',
      'Do not edit product code, tests, specs, docs, or evidence; do not commit, push, deploy, use network tools, inspect credentials, or access homelab.',
      'If no actionable Phase 41 contract defect remains, say so explicitly.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'The three exact headings exist with an explicit closure verdict',
    verification: { command: `test -s ${task.target} && grep -Fq '## P1-P2 findings' ${task.target} && grep -Fq '## Missing red tests' ${task.target}`, expectExit: 0, timeoutMs: 30_000 },
    budget: { tokens: 140_000, usd: task.harness === 'glm' ? 0.85 : 2, wallMin: 8 },
  });
}

if (!existsSync(glmAuth)) throw new Error('PENDING-LIVE-no-glm-auth-file');
if (!existsSync(codexAuth)) throw new Error('PENDING-LIVE-no-codex-auth-file');
mkdirSync(output, { recursive: true });
const adapters = {
  codex: new CodexAppServerCli({ requestTimeoutMs: 30_000, ceiling: 2 }),
  glm: new GlmSessionCli({
    authTokenFile: glmAuth,
    authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
    model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits',
    args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '0.85'],
    ceiling: 1, killGraceMs: 5_000,
  }),
};
const dependencyDirs = existsSync(join(repo, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const { coordinator, log } = createDriver({
  repoRoot: repo, logDir, adapters,
  runtimeIsolation: { credentialFiles: { codex: [codexAuth] } },
  workerDependencyDirs: dependencyDirs, verifyDependencyDirs: dependencyDirs,
  approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 360_000 },
});

const rows = []; const responses = []; const kills = []; let pumping = true; let fatal = null;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      responses.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped report.' }, 'orchestrator') });
    }
    await sleep(100);
  }
})();

try {
  await Promise.all(tasks.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), {
      taskId: task.taskId, taskType: 'phase41-contract-review', runId,
      model: task.model, effort: 'low',
      modelPolicy: { allow: [task.model], allowFamilies: [task.harness === 'codex' ? 'openai' : 'glm'], reasoningEffort: 'low' },
    });
    rows.push({ ...task, workerId: handle.id, handle });
  }));
  await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId);
    row.events = log.read(row.workerId);
    row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
    row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result?.status === 'completed' && row.verify?.payload?.accept === true && sha) {
      try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; }
    }
  }
  if (rows.some((row) => row.result?.status !== 'completed' || !row.report)) throw new Error(`review trust gate failed: ${JSON.stringify(rows.map((row) => ({ taskId: row.taskId, status: row.result?.status, report: !!row.report })))}`);
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  for (const row of rows) {
    row.events = log.read(row.workerId); row.pid ??= row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
    try { kills.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { kills.push({ taskId: row.taskId, error: String(error?.stack ?? error) }); }
  }
}

try {
  await until(() => rows.every((row) => (!row.pid || !alive(row.pid))
    && !existsSync(join(repo, '.baton', 'wt', row.taskId))
    && !existsSync(join(repo, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(repo, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'all review workers fully reaped', 30_000);
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }

for (const row of rows) {
  row.events = log.read(row.workerId);
  row.handle = coordinator.list().find((worker) => worker.id === row.workerId) ?? row.handle;
}
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const checks = {
  noHarnessError: fatal === null,
  expectedWorkers: rows.length === tasks.length,
  distinctNativePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === tasks.length,
  concurrentTurns: starts.length === tasks.length && terminals.length === tasks.length && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts))),
  exactRoutesObserved: rows.every((row) => row.handle?.harnessRequested === row.harness && row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model && row.handle?.effortRequested === 'low' && row.handle?.effortResolved === 'low'),
  freshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.report?.includes('## P1-P2 findings')),
  killsConfirmed: kills.length === tasks.length && kills.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => !row.pid || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(repo, '.baton', 'wt', row.taskId))),
  runtimesGone: rows.every((row) => !existsSync(join(repo, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), runId,
  rows: rows.map(({ events, report, ...row }) => ({ ...row, reportCaptured: !!report })), responses, kills, checks, fatal,
  pass: Object.values(checks).every(Boolean),
};
writeFileSync(join(output, 'events.jsonl'), `${rows.flatMap((row) => row.events.map((event) => JSON.stringify({ requestedHarness: row.harness, requestedModel: row.model, ...event }))).join('\n')}\n`);
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(output, `${row.taskId}.md`), row.report);
rmSync(logDir, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, routes: rows.map((row) => ({ harness: row.harness, requested: row.model, observed: row.handle?.modelObserved, effort: row.handle?.effortResolved, pid: row.pid })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
