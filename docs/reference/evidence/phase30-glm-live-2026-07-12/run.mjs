#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrief, createDriver, GlmSessionCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? 'glm_key.json');
const AUTH_JSON_POINTER = process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/env/ANTHROPIC_AUTH_TOKEN';
const MODEL = process.env.BATON_GLM_MODEL ?? 'glm-4.7';
const MAX_USD = process.env.BATON_GLM_MAX_BUDGET_USD ?? '0.10';
const TASK_ID = 'glm-phase30-live-review';
const TARGET = 'reviews/dogfood/phase30-glm-live-review.md';
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-glm-live-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

async function until(fn, label, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  const error = new Error(`timeout waiting for ${label}`);
  error.code = 'live_timeout';
  throw error;
}

function classify(error) {
  return { code: typeof error?.code === 'string' ? error.code : 'live_gate_failed', name: error?.name ?? 'Error' };
}

function boundedEvents(events) {
  const allowed = new Set([
    'runtime.scope_created', 'lifecycle.spawned', 'lifecycle.turn_started',
    'resource.tokens', 'lifecycle.turn_completed', 'verify.reverified',
    'model.mismatch', 'kill.requested', 'kill.confirmed',
  ]);
  return events.filter((event) => allowed.has(event.kind)).map((event) => ({
    seq: event.seq,
    ts: event.ts,
    actor: event.actor,
    kind: event.kind,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null,
    modelResolved: event.modelResolved ?? null,
    modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    pid: event.payload?.pid ?? null,
    tokens: event.kind === 'resource.tokens' ? event.payload?.tokens ?? null : null,
    usd: event.kind === 'resource.tokens' ? event.payload?.usd ?? null : null,
    accept: event.kind === 'verify.reverified' ? event.payload?.accept ?? null : null,
    status: event.kind === 'lifecycle.turn_completed' ? event.payload?.result?.status ?? null : null,
  }));
}

if (!existsSync(AUTH)) {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify({ pass: false, pending: 'credential_file_unavailable' }, null, 2)}\n`);
  process.exit(2);
}

const adapter = new GlmSessionCli({
  authTokenFile: AUTH,
  authTokenJsonPointer: AUTH_JSON_POINTER,
  model: MODEL,
  approvals: false,
  permissionMode: 'acceptEdits',
  args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', MAX_USD],
  ceiling: 1,
  killGraceMs: 5000,
});
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { glm: adapter },
  approvalTimeoutMs: 30000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: 180000 },
});
const brief = createBrief({
  goal: `Review the Phase 30 GLM credential and exact-model routing changes in spec/phase30/glm-live-honesty.md, impl/src/claude-session.mjs, and impl/test/glm-session.test.mjs. Write ${TARGET} with exactly the headings "## Verdict" and "## Findings". State whether the implementation is acceptable for this bounded live gate and list only concrete defects.`,
  constraints: [
    `Edit only ${TARGET}.`,
    'Do not inspect environment variables, credential files, runtime homes, or unrelated paths.',
    'Do not use network tools, commit, push, deploy, or access homelab systems.',
    'Keep the review under 500 words and stop after writing it.',
  ],
  pathScope: [TARGET],
  definitionOfDone: 'The two exact headings exist and the verdict is explicit',
  verification: {
    command: `test -s ${TARGET} && grep -q '^## Verdict$' ${TARGET} && grep -q '^## Findings$' ${TARGET}`,
    expectExit: 0,
    timeoutMs: 10000,
  },
  budget: { tokens: 40000, usd: Number(MAX_USD), wallMin: 4 },
});

let workerId = null;
let pid = null;
let result = null;
let killAck = null;
let failure = null;
try {
  const handle = await coordinator.spawn('glm', brief, {
    taskId: TASK_ID,
    taskType: 'live-routing-review',
    model: MODEL,
    modelPolicy: { allow: [MODEL], allowFamilies: ['glm'] },
  });
  workerId = handle.id;
  const spawned = await until(
    () => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'),
    'native GLM spawn',
  );
  pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'fresh verified GLM review');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') {
    const error = new Error('GLM result did not pass the trust gate');
    error.code = `result_${result.status ?? 'unknown'}`;
    throw error;
  }
  killAck = await coordinator.kill(workerId, 'orchestrator');
} catch (error) {
  failure = classify(error);
} finally {
  if (workerId) {
    if (!killAck) killAck = await Promise.resolve(coordinator.kill(workerId, 'policy')).catch((error) => ({ ok: false, failure: classify(error) }));
    try {
      await until(() => (!pid || !alive(pid))
        && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
        && !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`))
        && !existsSync(join(REPO, '.baton', 'runtime', workerId))
        && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'full GLM reap', 30000);
    } catch (error) {
      failure = failure ?? classify(error);
    }
  }
}

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const checks = {
  noHarnessError: failure === null,
  exactModelObserved: handle?.modelRequested === MODEL && handle?.modelResolved === MODEL && handle?.modelObserved === MODEL,
  providerUsageObserved: events.some((event) => event.kind === 'resource.tokens' && (event.payload?.tokens ?? 0) > 0),
  freshVerified: result?.status === 'completed' && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  killConfirmed: ['confirmed', 'already_dead'].includes(killAck?.result),
  processGone: !!pid && !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  metadataGone: !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  adapter: { harness: adapter.card().harness, version: adapter.card().version, authPosture: adapter.card().authPosture },
  route: { modelRequested: MODEL, modelResolved: handle?.modelResolved ?? null, modelObserved: handle?.modelObserved ?? null },
  workerId,
  pid,
  result: result ? { ready: result.ready, status: result.status, verdictAccept: result.verdict?.accept ?? null } : null,
  control: { killResult: killAck?.result ?? null },
  checks,
  failure,
  pass: Object.values(checks).every(Boolean),
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'events.jsonl'), boundedEvents(events).map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, route: summary.route, checks, failure }, null, 2));
if (!summary.pass) process.exitCode = 1;
