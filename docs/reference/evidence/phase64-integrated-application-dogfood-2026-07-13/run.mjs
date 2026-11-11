#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BatonApplication, ClaudeSessionCli, CodexAppServerCli, GlmSessionCli, GrokAcpCli, createDriver,
} from '../../../../impl/src/index.mjs';

if (!process.env.BATON_TARGET_REPO) throw new Error('PENDING-LIVE-baton-target-repo-required');
if (!process.env.BATON_EVIDENCE_OWNER_ROOT) throw new Error('PENDING-LIVE-baton-evidence-owner-root-required');
const SOURCE_REPO = realpathSync(resolve(process.env.BATON_SOURCE_REPO ?? resolve(import.meta.dirname, '../../../..')));
const TARGET_REPO = realpathSync(resolve(process.env.BATON_TARGET_REPO));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? import.meta.dirname);
const OWNER_ROOT = realpathSync(resolve(process.env.BATON_EVIDENCE_OWNER_ROOT));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? join(SOURCE_REPO, 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
const REPO_ID = 'baton-phase64-dogfood';
const LOG_DIR = mkdtempSync(join(OWNER_ROOT, 'log-'));
const TERMINAL = new Set(['work_completed', 'completed', 'failed', 'cancelled', 'denied', 'stopped']);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const processAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};
const processGroupAlive = (processGroupId) => {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) return false;
  try { process.kill(-processGroupId, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = ['impl/src/application.mjs', 'impl/src/coordinator.mjs', 'impl/src/coordination-store.mjs', 'impl/src/index.mjs'];
const runtimeDigest = (root) => sha(JSON.stringify(runtimeFiles.map((path) => [path, sha(readFileSync(join(root, path)))])));

if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-project-glm-key-absent');
if (execFileSync('git', ['status', '--porcelain'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim()) {
  throw new Error('PENDING-LIVE-dogfood-target-must-be-clean');
}

const routes = Object.freeze([
  { name: 'codex', harness: 'codex', model: 'gpt-5.6-sol', effort: 'low', target: 'reviews/dogfood/phase64-codex.md' },
  { name: 'claude', harness: 'claude', model: 'claude-opus-4-6', effort: 'low', target: 'reviews/dogfood/phase64-claude.md' },
  { name: 'glm', harness: 'glm', model: 'glm-4.7', effort: 'low', target: 'reviews/dogfood/phase64-glm.md' },
  { name: 'grok45', harness: 'grok', model: 'grok-4.5', effort: 'low', target: 'reviews/dogfood/phase64-grok45.md', stopProbe: true },
  { name: 'grokbuild', harness: 'grok', model: 'grok-build', effort: 'low', target: 'reviews/dogfood/phase64-grokbuild.md', stopProbe: true },
]);

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 32, maxPlanVersions: 32, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 8_192, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 128 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 512 * 1_024,
    maxTokens: 2_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const profile = (route) => Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  definitionOfDone: [
    'The report contains FINDINGS, CONTROL-SURFACE VERDICT, and NEXT INTEGRATION SLICE headings.',
    'Every finding names concrete source or test evidence.',
  ],
  constraints: [
    `Write only ${route.target}.`,
    'Inspect the integrated Run application, Web, MCP, browser desk, durable Run stop/reap, and their tests.',
    'Do not edit source, use homelab integration, publish, or contact external systems except the selected model provider.',
    'Distinguish a coherent application workflow from low-level kernel primitives and name any remaining operator assembly.',
  ],
  risk: 'high',
  goalBudget: { tokens: 300_000, usd: 5, wallMin: 20, providerTurns: 100 },
  nodeBudget: { tokens: 300_000, usd: 5, wallMin: 20, providerTurns: 100 },
  pathScope: [route.target],
  verification: {
    command: 'test', arguments: ['-s', route.target], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 64 * 1_024,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: route.harness, model: route.model, effort: route.effort }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (id) => Object.freeze({ actor: `dogfood:${id}`, principalId: id, sessionId: `${id}-session` });
const profiles = Object.fromEntries(routes.map((route) => [`review-${route.name}`, profile(route)]));
const credentials = {
  ...(existsSync(CODEX_AUTH) ? { codex: [CODEX_AUTH] } : {}),
  ...(existsSync(GROK_AUTH) ? { grok: [GROK_AUTH] } : {}),
};

const driver = createDriver({
  repoRoot: TARGET_REPO,
  repoId: REPO_ID,
  logDir: LOG_DIR,
  adapters: {
    codex: new CodexAppServerCli({ requestTimeoutMs: 45_000, model: 'gpt-5.6-sol', ceiling: 1 }),
    claude: new ClaudeSessionCli({ model: 'claude-opus-4-6', approvals: true, permissionMode: 'default', ceiling: 1 }),
    glm: new GlmSessionCli({
      authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
      model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits',
      args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '5.00'], ceiling: 1,
    }),
    grok: new GrokAcpCli({ requestTimeoutMs: 45_000, ceiling: 2 }),
  },
  runtimeIsolation: { credentialFiles: credentials },
  goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
  approvalTimeoutMs: 60_000,
  stopDeadlineMs: 15_000,
  drainPolicy: { maxWorkers: routes.length, timeoutMs: 90_000, pollMs: 10 },
  budgetPolicy: { terminalGraceMs: 2_000 },
  watchdog: { stallMs: 600_000 },
});

let application;
try {
  application = new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles,
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
} catch (error) {
  await driver.drainAndClose('dogfood:construction-failure');
  throw error;
}

let requestedSignal = null;
let signalShutdown = null;
const requestSignalShutdown = (signal) => {
  if (signalShutdown) return;
  requestedSignal = signal;
  signalShutdown = application.shutdown(principal('signal-shutdown')).catch(() => null);
};
process.on('SIGINT', () => requestSignalShutdown('SIGINT'));
process.on('SIGTERM', () => requestSignalShutdown('SIGTERM'));

const rows = new Map();
let pumping = true;
const answered = new Set();
const attentionPump = (async () => {
  while (pumping) {
    for (const route of routes) {
      const row = rows.get(route.name);
      if (!row) continue;
      let view;
      try { view = await application.status(row.runId, principal('operator')); } catch { continue; }
      for (const item of view.attention ?? []) {
        if (!item.requestId || answered.has(item.requestId)) continue;
        const answer = item.kind === 'answer_approval' ? { decision: 'allow' } : { text: 'Finish only the scoped report.' };
        try {
          await application.answer(row.runId, item.requestId, answer, principal('operator'));
          answered.add(item.requestId);
        } catch { /* retry unless the terminal state removes the attention item */ }
      }
    }
    await sleep(100);
  }
})();

function processRows(workerIds) {
  return workerIds.flatMap((workerId) => driver.log.read(workerId)
    .filter((event) => ['lifecycle.process_started', 'lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed'].includes(event.kind))
    .map((event) => ({
      workerId, kind: event.kind, generation: event.payload?.generation ?? null,
      pid: event.payload?.pid ?? null, processGroupId: event.payload?.processGroupId ?? null,
    })));
}

async function start(route) {
  const runId = `phase64-${route.name}`;
  const intent = {
    runId,
    objective: `Independently audit Baton's Phase 64 integrated Run application and write ${route.target}. Determine whether an agent can operate one coherent application rather than assemble a spaghettified suite. Focus on shared command semantics, exact ${route.harness}/${route.model}/${route.effort} routing, durable stop/reap, restart, and remaining friction.`,
    profile: `review-${route.name}`,
    route: { harness: route.harness, model: route.model, effort: route.effort },
    scope: [route.target],
  };
  const proposed = await application.command('run.start', { intent }, principal(`owner-${route.name}`));
  rows.set(route.name, { runId, proposed, approved: null, final: null });
  const approved = await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('operator'));
  rows.get(route.name).approved = approved;
  rows.get(route.name).workerIds = [...approved.ownership.workerIds];
  return approved;
}

let shutdown = null;
let fatal = null;
try {
  const reviewRoutes = routes.filter((route) => !route.stopProbe);
  const grokRoutes = routes.filter((route) => route.stopProbe);
  await Promise.all(reviewRoutes.map(start));
  await Promise.all(grokRoutes.map(start));

  const grokDeadline = Date.now() + 5_000;
  let simultaneousGrok = null;
  while (Date.now() < grokDeadline && !simultaneousGrok) {
    const views = await Promise.all(grokRoutes.map((route) => application.status(rows.get(route.name).runId, principal('operator'))));
    const workerIds = views.flatMap((view) => view.ownership.workerIds);
    const started = processRows(workerIds).filter((event) => event.kind === 'lifecycle.process_started');
    if (started.length >= 2 && new Set(started.map((event) => event.workerId)).size >= 2
      && started.every((event) => processAlive(event.pid))) simultaneousGrok = started;
    else await sleep(50);
  }

  await Promise.all(grokRoutes.map(async (route) => {
    const row = rows.get(route.name);
    row.final = await application.command('run.stop', { runId: row.runId, reason: 'Phase 64 concurrent Grok kill/reap probe complete' }, principal('operator'));
    row.evidence = await application.command('run.evidence', { runId: row.runId }, principal('operator'));
  }));

  await Promise.all(reviewRoutes.map(async (route) => {
    const row = rows.get(route.name);
    let view = await application.wait(row.runId, principal('operator'), { timeoutMs: 600_000 });
    if (!TERMINAL.has(view.phase)) view = await application.stop(row.runId, 'Phase 64 review deadline reached', principal('operator'));
    row.evidence = await application.command('run.evidence', { runId: row.runId }, principal('operator'));
    if (view.phase === 'work_completed' && row.evidence.result?.preservation?.state === 'pinned') {
      view = await application.command('run.adopt', {
        runId: row.runId,
        nodeKey: row.evidence.result.nodeKey,
        resultSha: row.evidence.result.sha,
        evidenceDigest: row.evidence.manifestDigest,
        reason: `Select the independently verified ${route.name} review as this Run's accepted result.`,
      }, principal('operator'));
    }
    row.final = view;
  }));

  mkdirSync(OUTPUT, { recursive: true });
  const exportedReviews = [];
  for (const route of reviewRoutes) {
    const row = rows.get(route.name);
    const resultSha = row.evidence?.result?.sha;
    if (!resultSha || row.final?.result?.adoption?.state !== 'adopted') continue;
    const destination = join(OUTPUT, `${route.name}-review.md`);
    const content = execFileSync('git', ['show', `${resultSha}:${route.target}`], {
      cwd: TARGET_REPO, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    writeFileSync(destination, content, { mode: 0o600 });
    exportedReviews.push({
      route: route.name, source: 'adopted-content-addressed-result',
      file: `${route.name}-review.md`, digest: sha(readFileSync(destination)),
      capturedSha: resultSha,
      evidenceDigest: row.evidence.manifestDigest,
      adoptionReceiptDigest: row.final.result.adoption.receiptDigest,
    });
  }

  const preShutdown = driver.coordinator.list();
  shutdown = await application.command('application.shutdown', {}, principal('shutdown-admin'));
  const allWorkerIds = [...new Set([...rows.values()].flatMap((row) => row.workerIds ?? []))];
  const processes = processRows(allWorkerIds);
  const started = processes.filter((event) => event.kind === 'lifecycle.process_started');
  const closed = processes.filter((event) => event.kind === 'lifecycle.process_closed');
  const reapUnconfirmed = processes.filter((event) => event.kind === 'lifecycle.process_reap_unconfirmed');
  const closedGenerations = new Set(closed.map((event) => `${event.workerId}:${event.generation}`));
  const unreaped = started.filter((event) => !closedGenerations.has(`${event.workerId}:${event.generation}`));
  const stillAlive = started.filter((event) => processAlive(event.pid) || processGroupAlive(event.processGroupId));
  const summary = {
    schemaVersion: 1,
    source: {
      runtimeHeadSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim(),
      targetSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim(),
      runtimeDigest: runtimeDigest(SOURCE_REPO), targetRuntimeDigest: runtimeDigest(TARGET_REPO),
    },
    applicationCommands: application.card().commands,
    routes: routes.map((route) => {
      const row = rows.get(route.name);
      return {
        name: route.name, runId: row.runId, phase: row.final.phase,
        requested: row.final.route.requested, resolved: row.final.route.resolved, observed: row.final.route.observed,
        stop: row.final.stop, ownership: row.final.ownership,
        result: row.final.result, evidenceDigest: row.evidence?.manifestDigest ?? null,
      };
    }),
    grok: { simultaneousLiveProcessesObserved: simultaneousGrok !== null, starts: simultaneousGrok ?? [] },
    exportedReviews,
    processes: { started: started.length, closed: closed.length, reapUnconfirmed, unreaped, stillAlive },
    preShutdownWorkers: preShutdown.length,
    shutdown,
  };
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  const stopReceiptsExact = grokRoutes.every((route) => {
    const receipt = rows.get(route.name).final?.stop?.receipt;
    return receipt?.targetCount === 1 && receipt.remainingCount === 0
      && receipt.counts.processesObserved === receipt.counts.processesClosed
      && receipt.counts.pendingCancelled + receipt.counts.killConfirmed + receipt.counts.alreadyTerminal === 1;
  });
  const reviewsPreserved = reviewRoutes.every((route) => exportedReviews.some((row) => row.route === route.name));
  const exactRouteMatrix = routes.every((route) => {
    const final = rows.get(route.name).final;
    const expected = { harness: route.harness, model: route.model, effort: route.effort };
    const requested = final?.route?.requested;
    const resolved = final?.route?.resolved;
    const observed = final?.route?.observed;
    return JSON.stringify(requested) === JSON.stringify(expected)
      && resolved?.model === route.model && resolved?.effort === route.effort
      && observed?.model === route.model && observed?.effort === route.effort;
  });
  const reviewsAccepted = reviewRoutes.every((route) => rows.get(route.name).final?.phase === 'work_completed'
    && rows.get(route.name).final?.result?.adoption?.state === 'adopted');
  if (unreaped.length > 0 || stillAlive.length > 0 || reapUnconfirmed.length > 0
    || closed.length !== started.length || shutdown?.receipt?.fleet?.remainingCount !== 0
    || simultaneousGrok === null || !stopReceiptsExact || !reviewsPreserved
    || !reviewsAccepted || !exactRouteMatrix
    || summary.source.runtimeDigest !== summary.source.targetRuntimeDigest) process.exitCode = 1;
} catch (error) {
  fatal = error;
  process.stderr.write(`phase64 integrated dogfood failed: ${error?.code ?? error?.message ?? 'unknown'}\n`);
  process.exitCode = 1;
} finally {
  pumping = false;
  await attentionPump;
  if (!shutdown) {
    try { shutdown = await application.shutdown(principal('shutdown-admin')); }
    catch (error) { if (!fatal) process.stderr.write(`phase64 cleanup failed: ${error?.code ?? error?.message ?? 'unknown'}\n`); }
  }
  if (signalShutdown) await signalShutdown;
  if (requestedSignal) process.exitCode = requestedSignal === 'SIGINT' ? 130 : 143;
}
