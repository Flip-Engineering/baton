#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClaudeSessionCli,
  CodexAppServerCli,
  GlmSessionCli,
  createBrief,
  createDriver,
} from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? 'glm_key.json');
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase47-harness-matrix-'));
const RUN_ID = process.env.BATON_RUN_ID ?? 'phase47-harness-matrix';
const ALL_TASKS = [
  {
    taskId: 'phase47-claude-ledger-review',
    harness: 'claude',
    model: 'claude-opus-4-6',
    family: 'claude',
    target: 'reviews/dogfood/phase47-claude-ledger-review.md',
    focus: 'append-before-validation poisoning, replay tampering, lifecycle-field ownership, and contradiction resolution authority',
    tokens: 80_000,
    usd: 3,
  },
  {
    taskId: 'phase47-codex-aci-review',
    harness: 'codex',
    model: 'gpt-5.6-sol',
    family: 'openai',
    target: 'reviews/dogfood/phase47-codex-aci-review.md',
    focus: 'deployment repository binding, direct versus web/MCP claim transport, idempotency binding, bounded artifacts, and cancellation',
    tokens: 160_000,
    usd: 3,
  },
  {
    taskId: 'phase47-glm-causal-review',
    harness: 'glm',
    model: 'glm-4.7',
    family: 'glm',
    target: 'reviews/dogfood/phase47-glm-causal-review.md',
    focus: 'bitemporal reads, typed earlier live lineage, bounded trace frontiers, contradiction classification, and retained full-system scope',
    tokens: 150_000,
    usd: 1.5,
  },
];
const selectedHarnesses = new Set((process.env.BATON_HARNESSES ?? 'claude,codex,glm').split(',').map((value) => value.trim()).filter(Boolean));
const TASKS = ALL_TASKS.filter((task) => selectedHarnesses.has(task.harness)).map((task) => ({
  ...task,
  tokens: Number(process.env[`BATON_${task.harness.toUpperCase()}_TOKENS`] ?? task.tokens),
  usd: Number(process.env[`BATON_${task.harness.toUpperCase()}_USD`] ?? task.usd),
}));
if (TASKS.length === 0) throw new Error('BATON_HARNESSES selected no configured harness');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

async function until(fn, label, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Adversarially review committed Phase 47 at ${git(['rev-parse', '--short', 'HEAD'])}, focusing on ${task.focus}. Read spec/phase47/cairn-causal-integrity-audit.md, impl/src/coordination-store.mjs, impl/src/cairn-run-scorecard.mjs, impl/src/capability-registry.mjs, impl/src/index.mjs, and impl/test/phase47-cairn-causal-audit.test.mjs. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required red tests".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Keep the report under 1600 words and use at most 14 repository/tool calls.',
      'Ground every finding in an exact source or contract seam and distinguish confirmed defects from retained future work.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, access homelab/project-manager, or edit product files.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'The three required headings exist with an explicit verdict and bounded red-test recommendations.',
    verification: {
      command: `test -s ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required red tests' ${task.target}`,
      expectExit: 0,
      timeoutMs: 30_000,
    },
    budget: { tokens: task.tokens, usd: task.usd, wallMin: 15 },
  });
}

function boundedEvents(events) {
  const allowed = new Set([
    'runtime.scope_created',
    'lifecycle.spawned',
    'lifecycle.turn_started',
    'lifecycle.turn_completed',
    'lifecycle.crashed',
    'resource.tokens',
    'resource.budget_threshold',
    'verify.reverified',
    'kill.requested',
    'kill.confirmed',
  ]);
  return events.filter((event) => allowed.has(event.kind)).map((event) => ({
    seq: event.seq,
    ts: event.ts,
    actor: event.actor,
    kind: event.kind,
    harnessRequested: event.harnessRequested ?? null,
    harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null,
    modelResolved: event.modelResolved ?? null,
    modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    effortRequested: event.effortRequested ?? null,
    effortResolved: event.effortResolved ?? null,
    effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'runtime.scope_created'
      ? {
          family: event.payload?.family ?? null,
          projectedFiles: event.payload?.projectedFiles ?? [],
          permissions: event.payload?.permissions ?? null,
          sandboxPolicy: event.payload?.sandboxPolicy ?? null,
        }
      : event.kind === 'lifecycle.spawned'
        ? {
            pid: event.payload?.pid ?? null,
            threadId: event.payload?.threadId ?? event.payload?.sessionId ?? null,
            modelObserved: event.payload?.modelObserved ?? null,
          }
        : event.kind === 'resource.tokens'
          ? {
              tokens: event.payload?.tokens ?? null,
              usd: event.payload?.usd ?? null,
              accounting: event.payload?.accounting ?? null,
            }
          : event.kind === 'resource.budget_threshold'
            ? {
                threshold: event.payload?.threshold ?? null,
                hardStop: event.payload?.hardStop ?? false,
                used: event.payload?.used ?? null,
                limits: event.payload?.limits ?? null,
              }
            : event.kind === 'verify.reverified'
              ? {
                  accept: event.payload?.accept ?? false,
                  observedExit: event.payload?.verdict?.observedExit ?? null,
                  captureSha: event.payload?.capture?.sha ?? null,
                }
              : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind)
                ? {
                    status: event.payload?.status ?? event.payload?.result?.status ?? null,
                    reason: String(event.payload?.error ?? event.payload?.reason ?? event.payload?.summary ?? '').slice(0, 256),
                  }
                : {},
  }));
}

if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
if (!existsSync(CODEX_AUTH)) throw new Error('PENDING-LIVE-no-codex-auth');
mkdirSync(OUTPUT, { recursive: true });

const adapters = {
  claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default', ceiling: 1 }),
  codex: new CodexAppServerCli({ requestTimeoutMs: 30_000, ceiling: 1 }),
  glm: new GlmSessionCli({
    authTokenFile: GLM_AUTH,
    authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
    model: 'glm-4.7',
    approvals: false,
    permissionMode: 'acceptEdits',
    args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '1.50'],
    ceiling: 1,
    killGraceMs: 5_000,
  }),
};
const dependencies = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const driver = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters,
  runtimeIsolation: { credentialFiles: { codex: [CODEX_AUTH] } },
  workerDependencyDirs: dependencies,
  verifyDependencyDirs: dependencies,
  approvalTimeoutMs: 60_000,
  stopDeadlineMs: 15_000,
  watchdog: { stallMs: 600_000 },
});
const { coordinator, log } = driver;
const rows = [];
const responses = [];
const kills = [];
let pumping = true;
let fatal = null;
let closed = false;

const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const id = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!id || consumed.has(id)) continue;
      consumed.add(id);
      responses.push({
        workerId: worker.id,
        requestId: id,
        ack: await coordinator.respond(
          id,
          worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped review.' },
          'orchestrator',
        ),
      });
    }
    await sleep(100);
  }
})();

try {
  await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), {
      taskId: task.taskId,
      taskType: 'phase47-causal-integrity-review',
      runId: RUN_ID,
      model: task.model,
      effort: 'low',
      modelPolicy: {
        allow: [task.model],
        allowFamilies: [task.family],
        reasoningEffort: 'low',
      },
    });
    rows.push({ ...task, workerId: handle.id, handle });
  }));
  await Promise.all(rows.map((row) => until(
    async () => (await coordinator.result(row.workerId)).ready,
    `${row.taskId} terminal result`,
  )));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId);
    row.events = log.read(row.workerId);
    row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
    row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) {
      try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; }
    }
  }
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  for (const row of rows) {
    row.events = log.read(row.workerId);
    row.pid ??= row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
    try { kills.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { kills.push({ taskId: row.taskId, error: String(error?.stack ?? error) }); }
  }
}

try {
  await until(() => rows.every((row) =>
    (!row.pid || !alive(row.pid))
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''
  ), 'all harness workers fully reaped', 30_000);
  closed = driver.close();
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}

for (const row of rows) {
  row.events = log.read(row.workerId);
  row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId));
}
const coordinationRoot = join(LOG_DIR, 'coordination');
const checks = {
  runnerHealthy: fatal === null,
  allHarnessesAdmitted: rows.length === TASKS.length,
  exactRoutesRequestedResolved: rows.every((row) =>
    row.handle.harnessRequested === row.harness
    && row.handle.modelRequested === row.model
    && row.handle.modelResolved === row.model
    && row.handle.effortRequested === 'low'
    && row.handle.effortResolved === 'low'),
  exactProviderModelsObserved: rows.every((row) => row.handle.modelObserved === row.model),
  freshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.report?.includes('## Required red tests')),
  killSafe: kills.length === TASKS.length && kills.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => !row.pid || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
  writerAuthorityReleased: closed === true
    && !existsSync(join(coordinationRoot, 'writer.lease'))
    && (!existsSync(coordinationRoot) || !readdirSync(coordinationRoot).some((name) => name.startsWith('writer.claim.'))),
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  runId: RUN_ID,
  credentialPosture: {
    glm: 'project-local owner-only ignored file loaded only by GlmSessionCli',
    codex: 'explicit owner-only private runtime projection',
    claude: 'subscription/keychain; no credential file projection',
  },
  rows: rows.map((row) => ({
    taskId: row.taskId,
    harness: row.harness,
    model: row.model,
    target: row.target,
    workerId: row.workerId,
    pid: row.pid,
    result: row.result ? { status: row.result.status, ready: row.result.ready } : null,
    route: {
      harnessRequested: row.handle.harnessRequested,
      harnessResolved: row.handle.harnessResolved,
      modelRequested: row.handle.modelRequested,
      modelResolved: row.handle.modelResolved,
      modelObserved: row.handle.modelObserved,
      effortRequested: row.handle.effortRequested,
      effortResolved: row.handle.effortResolved,
      effortObserved: row.handle.effortObserved,
    },
    budgetUsed: row.handle.budgetUsed,
    verifyAccept: row.verify?.payload?.accept ?? false,
    reportCaptured: Boolean(row.report),
  })),
  responses,
  kills,
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) =>
  boundedEvents(row.events).map((event) => JSON.stringify({
    requestedHarness: row.harness,
    requestedModel: row.model,
    requestedEffort: 'low',
    taskId: row.taskId,
    ...event,
  }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
rmSync(LOG_DIR, { recursive: true, force: true });

console.log(JSON.stringify({
  pass: summary.pass,
  routes: summary.rows.map((row) => ({ harness: row.harness, ...row.route, pid: row.pid, reportCaptured: row.reportCaptured })),
  checks,
  fatal,
}, null, 2));
if (!summary.pass) process.exitCode = 1;
