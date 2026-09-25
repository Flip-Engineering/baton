#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GlmSessionCli } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.BATON_REPO ?? resolve(here, '../../../..'));
const output = resolve(process.env.BATON_EVIDENCE_DIR ?? here);
const auth = resolve(process.env.BATON_GLM_AUTH_FILE ?? 'glm_key.json');
const logDir = mkdtempSync(join(tmpdir(), 'baton-phase40-glm-review-'));
const taskId = 'phase40-proposed-graph-glm-review';
const target = 'reviews/dogfood/phase40-proposed-graph-glm-review.md';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

async function until(fn, label, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

if (!existsSync(auth)) throw new Error('PENDING-LIVE-no-glm-auth-file');
mkdirSync(output, { recursive: true });
const adapter = new GlmSessionCli({
  authTokenFile: auth, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER,
  model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits',
  args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '0.40'], ceiling: 1, killGraceMs: 5_000,
});
const dependencyDirs = existsSync(join(repo, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const { coordinator, log } = createDriver({
  repoRoot: repo, logDir, adapters: { glm: adapter }, workerDependencyDirs: dependencyDirs,
  verifyDependencyDirs: dependencyDirs, approvalTimeoutMs: 30_000, stopDeadlineMs: 15_000,
  watchdog: { stallMs: 300_000 },
});
const brief = createBrief({
  goal: `Adversarially review Phase 40's proposed install graph contract at ${git(['rev-parse', '--short', 'HEAD'])}. Read spec/phase40/proposed-install-graph.md, spec/phase37/lockfile-sbom.md, spec/phase38/immutable-reuse-decision.md, impl/src/cartographer-quartermaster.mjs, and the relevant Phase 37-39 tests. Write ${target} with exactly "## Verdict", "## Missing invariants", "## Attack sequences", and "## Red-test plan". Focus on actual/proposed confusion, resolver authority, lifecycle scripts, source races, coordinate substitution, graph-delta honesty, artifact/replay integrity, and accidental install/decision authority.`,
  constraints: [
    `Edit only ${target}.`,
    'Use at most 12 repository tool calls and keep the report under 2200 words.',
    'Every proposed defect must cite an exact contract or source seam and a reproducible sequence.',
    'Do not edit product code/tests/spec/evidence, commit, push, deploy, use network tools, inspect credentials, access homelab, or run a package manager.',
    'Distinguish Phase 40 defects from later reachability, ecosystems, Socket, Sigstore/SLSA, and install authority.',
  ],
  pathScope: [target], definitionOfDone: 'The four exact headings exist with an actionable red-test plan',
  verification: { command: `test -s ${target} && grep -Fq '## Red-test plan' ${target}`, expectExit: 0, timeoutMs: 20_000 },
  budget: { tokens: 60_000, usd: 0.40, wallMin: 6 },
});

let workerId = null; let pid = null; let result = null; let report = null; let killAck = null; let fatal = null;
try {
  const handle = await coordinator.spawn('glm', brief, {
    taskId, taskType: 'phase40-contract-review', model: 'glm-4.7', effort: 'low',
    modelPolicy: { allow: ['glm-4.7'], allowFamilies: ['glm'], reasoningEffort: 'low' },
  });
  workerId = handle.id;
  await until(() => {
    const event = log.read(workerId).find((row) => row.kind === 'lifecycle.spawned' && row.actor === 'worker');
    pid = event?.payload?.pid ?? pid; return event ?? null;
  }, 'native GLM spawn');
  await until(async () => (await coordinator.result(workerId)).ready, 'verified GLM result');
  result = await coordinator.result(workerId);
  const verified = log.read(workerId).find((row) => row.kind === 'verify.reverified');
  const sha = verified?.payload?.capture?.sha;
  if (sha) report = git(['show', `${sha}:${target}`]);
  if (result.status !== 'completed' || !report) throw new Error(`GLM review failed trust gate: ${result.status}`);
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  if (workerId) killAck = await Promise.resolve(coordinator.kill(workerId, 'policy')).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
}

try {
  if (workerId) await until(() => (!pid || !alive(pid))
    && !existsSync(join(repo, '.baton', 'wt', taskId))
    && !existsSync(join(repo, '.baton', 'wt', `${taskId}.meta.json`))
    && !existsSync(join(repo, '.baton', 'runtime', workerId))
    && git(['branch', '--list', `baton/${taskId}`]) === '', 'complete GLM reap', 30_000);
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((row) => row.id === workerId) : null;
const verify = events.find((row) => row.kind === 'verify.reverified');
const checks = {
  noHarnessError: fatal === null,
  nativePidObserved: Number.isSafeInteger(pid),
  exactRouteObserved: handle?.harnessRequested === 'glm' && handle?.modelRequested === 'glm-4.7'
    && handle?.modelResolved === 'glm-4.7' && handle?.modelObserved === 'glm-4.7'
    && handle?.effortRequested === 'low' && handle?.effortResolved === 'low',
  freshlyVerified: result?.status === 'completed' && verify?.payload?.accept === true,
  reportCaptured: report?.includes('## Red-test plan') === true,
  killConfirmed: ['confirmed', 'already_dead'].includes(killAck?.result),
  processGone: !pid || !alive(pid),
  worktreeGone: !existsSync(join(repo, '.baton', 'wt', taskId)),
  runtimeGone: !workerId || !existsSync(join(repo, '.baton', 'runtime', workerId)),
  branchGone: git(['branch', '--list', `baton/${taskId}`]) === '',
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), taskId, checks, handle, result, killAck, fatal, pass: Object.values(checks).every(Boolean) };
if (report) writeFileSync(join(output, 'review.md'), report);
writeFileSync(join(output, 'events.jsonl'), `${events.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(logDir, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
