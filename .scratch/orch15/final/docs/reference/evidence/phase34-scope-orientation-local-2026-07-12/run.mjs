#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, MockAdapter, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase34-scope-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const gitAt = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(25); }
  throw new Error(`timeout waiting for ${label}`);
}

mkdirSync(HERE, { recursive: true });
let summary; let driver; let worker;
try {
  const sourceRoot = join(scratch, 'source'); mkdirSync(join(sourceRoot, 'impl/src'), { recursive: true });
  for (const name of ['cartographer-quartermaster.mjs', 'coordinator.mjs', 'capability-registry.mjs', 'atlas-index.mjs']) cpSync(join(REPO, 'impl/src', name), join(sourceRoot, 'impl/src', name));
  const atlas = new AtlasCodeIndex({ artifactRoot: join(scratch, 'atlas') });
  const built = await atlas.invoke('index.build', {}, { actor: 'orchestrator', baseRoot: sourceRoot, budgetTokens: 100_000 });
  const workerRepo = join(scratch, 'worker-repo'); mkdirSync(join(workerRepo, 'src'), { recursive: true });
  writeFileSync(join(workerRepo, 'src', 'base.md'), 'clean worker base\n');
  gitAt(workerRepo, ['init', '-q']); gitAt(workerRepo, ['add', '.']);
  gitAt(workerRepo, ['-c', 'user.name=Baton Dogfood', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base']);
  const adapter = new MockAdapter({ card: { harness: 'mock-scope-orientation', version: '1' }, scenario: { outcome: 'completed', edits: [
    { path: 'docs/drift.md', content: 'outside\n' },
    { path: 'src/hold.md', content: 'late\n', delayMs: 60_000 },
  ] } });
  driver = createDriver({
    repoRoot: workerRepo, logDir: join(scratch, 'driver'), adapters: { mock: adapter }, stopDeadlineMs: 5_000,
    capabilityFactories: { 'cartographer-quartermaster': () => new CartographerQuartermaster({ atlas, artifactRoot: join(scratch, 'orientation') }) },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: sourceRoot } },
    maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 512 * 1024,
    watchdog: { stallMs: 0, scopeAction: 'orient', orientation: {
      indexEpoch: built.provenance.index_epoch, focus: 'impl/src/cartographer-quartermaster.mjs', shape: 'map',
      budgetTokens: 2_000, cooldownMs: 1_000, maxRefreshesPerTurn: 1, notePrefix: 'Dogfood scope reorientation.',
    } },
  });
  const brief = createBrief({
    goal: 'Emit one outside-scope edit and receive automatic orientation', constraints: [], pathScope: ['src/**'], definitionOfDone: 'src/hold.md exists',
    verification: { command: 'test -s src/hold.md', expectExit: 0, timeoutMs: 5_000 }, budget: { tokens: 1_000, usd: 1, wallMin: 2 },
  });
  worker = await driver.coordinator.spawn('mock', brief, { taskId: 'phase34-scope-dogfood', taskType: 'scope-orientation-dogfood', runId: 'phase34-scope-orientation' });
  let violation;
  try { violation = await until(() => driver.log.read(worker.id).find((event) => event.kind === 'health.scope_violation'), 'mechanical scope violation'); }
  catch (error) {
    const diagnostics = driver.log.read(worker.id);
    throw new Error(`${error.message}; observed=${JSON.stringify(diagnostics.map((event) => ({ kind: event.kind, payload: event.kind === 'lifecycle.crashed' ? event.payload : undefined })))}`);
  }
  const orientationOutcome = await until(() => driver.log.read(worker.id).find((event) => ['knowledge.map_served', 'health.scope_refresh_refused'].includes(event.kind)), 'automatic orientation outcome');
  if (orientationOutcome.kind !== 'knowledge.map_served') throw new Error(`automatic orientation refused: ${JSON.stringify(orientationOutcome.payload)}`);
  const served = orientationOutcome;
  const stopped = await driver.coordinator.kill(worker.id, 'orchestrator');
  await until(() => !existsSync(join(workerRepo, '.baton', 'wt', 'phase34-scope-dogfood'))
    && !existsSync(join(workerRepo, '.baton', 'wt', 'phase34-scope-dogfood.meta.json'))
    && !existsSync(join(workerRepo, '.baton', 'runtime', worker.id))
    && gitAt(workerRepo, ['branch', '--list', 'baton/phase34-scope-dogfood']) === '', 'worker resource reap');
  const events = driver.log.read(worker.id);
  const checks = {
    mechanicalViolation: violation?.payload?.path === 'docs/drift.md' && violation?.payload?.action === 'orient' && violation?.payload?.refresh === 'scheduled',
    automaticPolicyActor: served?.actor === 'policy',
    exactAddress: served?.worker === worker.id && served?.taskId === 'phase34-scope-dogfood' && served?.runId === 'phase34-scope-orientation',
    typedFocusDelivered: served?.payload?.message?.slice?.payload?.some((item) => item.path === 'impl/src/cartographer-quartermaster.mjs'),
    driftInNote: served?.payload?.message?.note?.includes('docs/drift.md') === true,
    hostPathWithheld: served?.payload?.message?.slice?.refs?.every((ref) => !Object.hasOwn(ref, 'path')) === true,
    oneRefresh: events.filter((event) => event.kind === 'knowledge.map_served').length === 1,
    noFalseRefusal: events.every((event) => event.kind !== 'health.scope_refresh_refused'),
    killConfirmed: ['confirmed', 'already_dead'].includes(stopped.result),
    worktreeGone: !existsSync(join(workerRepo, '.baton', 'wt', 'phase34-scope-dogfood')),
    metadataGone: !existsSync(join(workerRepo, '.baton', 'wt', 'phase34-scope-dogfood.meta.json')),
    runtimeGone: !existsSync(join(workerRepo, '.baton', 'runtime', worker.id)),
    branchGone: gitAt(workerRepo, ['branch', '--list', 'baton/phase34-scope-dogfood']) === '',
  };
  summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), atlasEpoch: built.provenance.index_epoch, workerId: worker.id, violation: violation?.payload, sliceDigest: served?.payload?.message?.slice?.refs?.[0]?.digest, stopped, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(HERE, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (driver && worker) await driver.coordinator.kill(worker.id, 'policy').catch(() => {});
  rmSync(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify({ pass: summary?.pass ?? false, checks: summary?.checks ?? null }, null, 2));
if (!summary?.pass) process.exitCode = 1;
