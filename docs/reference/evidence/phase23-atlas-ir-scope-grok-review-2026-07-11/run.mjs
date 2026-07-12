#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const AUTH = join(homedir(), '.grok', 'auth.json');
const TIMEOUT_MS = Number(process.env.BATON_REVIEW_TIMEOUT_MS ?? 360000);
const MIN_FREE_BYTES = Number(process.env.BATON_MIN_FREE_BYTES ?? 256 * 1024 * 1024);
const REVIEW_PROFILE = process.env.BATON_REVIEW_PROFILE ?? 'ir-scope';
const IR_TASKS = [
  { taskId: 'grok-ir-scope-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-ir-scope-45.md', stance: 'constructive' },
  { taskId: 'grok-ir-scope-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-ir-scope-composer.md', stance: 'adversarial' },
];
const BEHAVIOR_TASKS = [
  { taskId: 'grok-behavior-review-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-behavior-review-45.md', stance: 'security' },
  { taskId: 'grok-behavior-review-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-behavior-review-composer.md', stance: 'semantics' },
];
const MERGE_TASKS = [
  { taskId: 'grok-merge-scope-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-merge-scope-45.md', stance: 'authority' },
  { taskId: 'grok-merge-scope-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-merge-scope-composer.md', stance: 'semantics' },
];
const TASKS = REVIEW_PROFILE === 'behavior-implementation' ? BEHAVIOR_TASKS
  : REVIEW_PROFILE === 'merge-scope' ? MERGE_TASKS
    : IR_TASKS;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

async function until(fn, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  if (REVIEW_PROFILE === 'behavior-implementation') {
    const focus = task.stance === 'security'
      ? 'Prioritize adversarial child-code attacks on permission confinement, environment stripping, output framing/intrinsic mutation, process/timeout cleanup, and artifact trust.'
      : 'Prioritize fingerprint/delta semantics, nondeterminism, corpus and serialization edge cases, resume/reverify determinism, ACI claim language, and missing reds.';
    return createBrief({
      goal: `Adversarially review committed Phase 25 BF1-BF7 at ${git(['rev-parse', '--short', 'HEAD'])}. Read spec/phase25/atlas-behavior-fingerprint.md, impl/src/atlas-behavior-fingerprint.mjs, impl/test/phase25-atlas-behavior-fingerprint.test.mjs, its Baton-on-Baton evidence, and the R5 plan in docs/15 and docs/26. ${focus} Construct concrete failure sequences and distinguish an implementation defect from an explicit non-goal. Write ${task.path} with exact headings "## Decision", "## Proposed numbered contract", "## Red tests and proof", and "## Risks and rejection criteria". Under Decision, state whether any actionable BF1-BF7 defect remains; Proposed numbered contract must give a BF1-BF7 implementation matrix rather than expand scope.`,
      constraints: [
        `Edit only ${task.path}.`,
        'Use at most 14 repository or tool calls, then finish from collected evidence.',
        'Ground findings in exact source locations and reproducible sequences; do not trust worker or target-code output.',
        'No homelab integration or dependency. Do not use network tools, read credentials, edit product code/specs/tests/evidence, commit, push, or deploy.',
        'Keep the report under 2800 words. If no actionable defect remains, say so explicitly.',
      ],
      pathScope: [task.path],
      definitionOfDone: 'The four exact headings exist and every BF1-BF7 seam has an evidence-backed verdict',
      verification: { command: `test -s ${task.path} && grep -Fq '## Proposed numbered contract' ${task.path} && grep -Fq '## Risks and rejection criteria' ${task.path} && git diff --check -- ${task.path}`, expectExit: 0, timeoutMs: 180000 },
      budget: { tokens: 50000, usd: 4, wallMin: 9 },
    });
  }
  if (REVIEW_PROFILE === 'merge-scope') {
    const focus = task.stance === 'authority'
      ? 'Prioritize Git authority, isolated staging, tool invocation/configuration, dirty-main preservation, post-merge trust gates, rollback, crash/replay ambiguity, artifact retention, and cleanup.'
      : 'Prioritize the exact boundary between external syntax-aware structured merge and unproven CPG/data-flow semantic merge, conflict classification, behavioral/CPG evidence, false-clean risk, and honest claim language.';
    return createBrief({
      goal: `Design-review Baton's next structured/semantic merge increment at ${git(['rev-parse', '--short', 'HEAD'])}. Read SYSTEM.md, docs/15-representation-and-computation.md, docs/21-frontier-features.md, docs/26-full-system-goal.md, reviews/frontier-features/representation.md, spec/phase11/acceptance-integration.md, impl/src/{coordinator,index,worktree,atlas-cpg-delta,atlas-behavior-fingerprint}.mjs, and integration tests. The host has no Mergiraf binary. ${focus} Decide the smallest honest numbered vertical that adopts/wraps Mergiraf rather than inventing a parser, remains testable through injected execution, stages without mutating main, requires fresh verification before any main update, fails closed on unavailable tools/unresolved markers/parse fallback/semantic overlap, and never treats behavioral corpus agreement as merge authority. Include explicit keep/redirect/retire criteria for true semantic merge. Write ${task.path} with exact headings "## Decision", "## Proposed numbered contract", "## Red tests and proof", and "## Risks and rejection criteria".`,
      constraints: [
        `Edit only ${task.path}.`,
        'Use at most 14 repository or tool calls, then finish from collected evidence.',
        'Ground the proposal in current Baton source and upstream Mergiraf command semantics already summarized in repository research; do not invent a merge algorithm.',
        'No homelab integration or dependency. Do not use network tools, read credentials, edit product code/specs/tests/evidence, commit, push, deploy, or install software.',
        'Keep the report under 3000 words and state one unambiguous implementation sequence.',
      ],
      pathScope: [task.path],
      definitionOfDone: 'The four exact headings exist, authority and semantic boundaries are explicit, and every proposed merge claim has a falsifiable gate',
      verification: { command: `test -s ${task.path} && grep -Fq '## Proposed numbered contract' ${task.path} && grep -Fq '## Risks and rejection criteria' ${task.path} && git diff --check -- ${task.path}`, expectExit: 0, timeoutMs: 180000 },
      budget: { tokens: 50000, usd: 4, wallMin: 9 },
    });
  }
  const stance = task.stance === 'constructive'
    ? 'Propose the smallest honest R4 vertical worth building now.'
    : 'Try to falsify the premise that an R4 vertical belongs next; recommend redirect or an explicit negative evaluation if that is more honest.';
  return createBrief({
    goal: `Review Baton's intended R4 compiler/intermediate-representation and semantic-delta rung at ${git(['rev-parse', '--short', 'HEAD'])}. Read docs/15-representation-and-computation.md, docs/26-full-system-goal.md, reviews/frontier-features/representation.md, the Phase 18-22 CPG implementation/specs/tests, and current Atlas artifact conventions. ${stance} Resolve whether JavaScript/TypeScript needs a real external compiler IR, a deliberately scoped Baton IR, a language fixture, or a measured negative gate. Do not relabel AST/CPG as compiler IR. Cover value proposition, exact semantics, tool/substrate choice, delta/translation-validation relationship, ACI envelope, artifact schema, bounds/cancellation/resume/tamper/reverify, integration seams, red tests, live Baton-on-Baton proof, honest limitations, and keep/redirect/retire criteria. Write ${task.path} with exact headings "## Decision", "## Proposed numbered contract", "## Red tests and proof", and "## Risks and rejection criteria".`,
    constraints: [
      `Edit only ${task.path}.`,
      'Use at most 12 repository or tool calls, then finish the report from collected evidence.',
      'Ground every proposal in current source or plan text and distinguish existing capability from new work.',
      'No homelab integration or dependency. Do not use network tools, read credentials, edit product code/specs/evidence, commit, push, or deploy.',
      'Keep the report under 2600 words and state one unambiguous next action.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist, the decision is unambiguous, and the proposed contract is falsifiable',
    verification: {
      command: `test -s ${task.path} && grep -Fq '## Proposed numbered contract' ${task.path} && grep -Fq '## Risks and rejection criteria' ${task.path} && git diff --check -- ${task.path}`,
      expectExit: 0,
      timeoutMs: 180000,
    },
    budget: { tokens: 50000, usd: 4, wallMin: 9 },
  });
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) throw new Error('BATON_REVIEW_TIMEOUT_MS must be positive');
if (!Number.isFinite(MIN_FREE_BYTES) || MIN_FREE_BYTES <= 0) throw new Error('BATON_MIN_FREE_BYTES must be positive');
const fs = statfsSync(REPO); const freeBytes = fs.bavail * fs.bsize;
if (freeBytes < MIN_FREE_BYTES) throw new Error(`PENDING-LIVE-insufficient-disk-headroom:${freeBytes}<${MIN_FREE_BYTES}`);
const LOG_DIR = mkdtempSync(join(tmpdir(), `baton-${REVIEW_PROFILE}-review-`));
const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: TASKS.length });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  runtimeIsolation: { credentialFiles: { grok: [AUTH] } },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: TIMEOUT_MS },
});

const rows = [];
const approvals = [];
const stopResults = [];
const stopped = new Set();
let pumping = true;
let fatal = null;
let pumpError = null;

function hydrate(row) {
  try { row.handle = coordinator.list().find((worker) => worker.id === row.workerId) ?? row.handle; } catch { /* poison-safe hydration */ }
  try { row.events = log.read(row.workerId); } catch { row.events ??= []; }
  row.pid = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? row.pid ?? null;
  row.verify = row.events.find((event) => event.kind === 'verify.reverified') ?? row.verify ?? null;
  const sha = row.verify?.payload?.capture?.sha;
  if (sha && !row.review) {
    try { row.review = git(['show', `${sha}:${row.path}`]); }
    catch (error) { row.reviewCaptureError = String(error?.stack ?? error); }
  }
}

async function stop(row) {
  if (stopped.has(row.workerId)) return;
  stopped.add(row.workerId);
  try {
    stopResults.push({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') });
  } catch (error) {
    if (!['operational_log_unavailable', 'coordination_write_unavailable'].includes(error?.code)) {
      stopResults.push({ taskId: row.taskId, error: String(error?.stack ?? error) });
      return;
    }
    try {
      stopResults.push({ taskId: row.taskId, degradedEmergency: true, ack: await coordinator.kill(row.workerId, 'policy', { emergency: true }), poison: error.code });
    } catch (emergencyError) {
      stopResults.push({ taskId: row.taskId, degradedEmergency: true, error: String(emergencyError?.stack ?? emergencyError), poison: error.code });
    }
  }
}

const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      approvals.push({
        workerId: worker.id,
        requestId,
        ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the bounded report now.' }, 'human'),
      });
    }
    await sleep(100);
  }
})().catch((error) => { pumpError = String(error?.stack ?? error); });

try {
  const spawned = await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', brief(task), {
      taskId: task.taskId,
      taskType: REVIEW_PROFILE === 'behavior-implementation' ? 'adversarial-implementation-review'
        : REVIEW_PROFILE === 'merge-scope' ? 'merge-design-review'
          : 'representation-design-review',
      model: task.model,
      modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    const row = { ...task, workerId: handle.id, handle };
    rows.push(row);
    hydrate(row);
    return row;
  }));
  const waits = await Promise.allSettled(spawned.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of spawned) { row.result = await coordinator.result(row.workerId); hydrate(row); }
  const failures = waits.map((wait, index) => wait.status === 'rejected' ? `${spawned[index].taskId}: ${wait.reason}` : null).filter(Boolean);
  if (failures.length) throw new Error(`review waits failed:\n${failures.join('\n')}`);
  const rejected = spawned.filter((row) => row.result.status !== 'completed');
  if (rejected.length) throw new Error(`review trust gates failed: ${JSON.stringify(rejected.map((row) => ({ taskId: row.taskId, result: row.result })))}`);
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump;
  for (const row of rows) { hydrate(row); await stop(row); hydrate(row); }
}
if (pumpError) fatal = [fatal, pumpError].filter(Boolean).join('\n');

try {
  await until(() => rows.every((row) =>
    !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''
  ), 'both selected reviewers fully reaped', 30000);
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}

for (const row of rows) hydrate(row);
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const checks = {
  noHarnessError: fatal === null,
  twoReviews: rows.length === 2,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: starts.length === 2 && terminals.length === 2 && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  bothFreshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => row.review?.includes('## Proposed numbered contract')),
  bothKillsConfirmed: stopResults.length === 2 && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  reviewProfile: REVIEW_PROFILE,
  reviewTimeoutMs: TIMEOUT_MS,
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  rows: rows.map(({ events, ...row }) => row),
  approvals,
  stopResults,
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ taskId: row.taskId, requestedModel: row.model, ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
