#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, MockAdapter, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase33-orient-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(25); }
  throw new Error(`timeout waiting for ${label}`);
}

mkdirSync(HERE, { recursive: true });
let summary; let driver; let worker;
try {
  const sourceRoot = join(scratch, 'source');
  mkdirSync(join(sourceRoot, 'impl/src'), { recursive: true });
  for (const name of ['cartographer-quartermaster.mjs', 'coordinator.mjs', 'capability-registry.mjs', 'atlas-index.mjs']) {
    cpSync(join(REPO, 'impl/src', name), join(sourceRoot, 'impl/src', name));
  }
  const atlas = new AtlasCodeIndex({ artifactRoot: join(scratch, 'atlas') });
  const built = await atlas.invoke('index.build', {}, { actor: 'orchestrator', baseRoot: sourceRoot, budgetTokens: 100_000 });
  const adapter = new MockAdapter({ card: { harness: 'mock-orientation', version: '1' }, scenario: { outcome: 'completed', edits: [{ path: 'phase33.tmp', content: 'late\n', delayMs: 60_000 }] } });
  driver = createDriver({
    repoRoot: REPO, logDir: join(scratch, 'driver'), adapters: { mock: adapter }, stopDeadlineMs: 5_000,
    capabilityFactories: { 'cartographer-quartermaster': () => new CartographerQuartermaster({ atlas, artifactRoot: join(scratch, 'orientation') }) },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: sourceRoot } },
    maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 512 * 1024,
  });
  const brief = createBrief({
    goal: 'Remain active long enough to receive one addressed orientation slice', constraints: [], pathScope: ['phase33.tmp'], definitionOfDone: 'phase33.tmp exists',
    verification: { command: 'test -s phase33.tmp', expectExit: 0, timeoutMs: 5_000 }, budget: { tokens: 1_000, usd: 1, wallMin: 2 },
  });
  worker = await driver.coordinator.spawn('mock', brief, { taskId: 'phase33-orient-dogfood', taskType: 'orientation-dogfood', runId: 'phase33-orientation' });
  await until(() => driver.log.read(worker.id).some((event) => event.kind === 'lifecycle.turn_started'), 'worker turn start');
  const fence = driver.coordinator.list().find((item) => item.id === worker.id).fence;
  const pushed = await driver.coordinator.orientWorker(worker.id, { indexEpoch: built.provenance.index_epoch, focus: 'impl/src/cartographer-quartermaster.mjs', shape: 'map' }, 'Use this exact implementation boundary for the review.', { actor: 'orchestrator', budgetTokens: 2_000, expectedFence: fence });
  const served = driver.log.read(worker.id).find((event) => event.kind === 'knowledge.map_served');
  const stopped = await driver.coordinator.kill(worker.id, 'orchestrator');
  await until(() => !existsSync(join(REPO, '.baton', 'wt', 'phase33-orient-dogfood'))
    && !existsSync(join(REPO, '.baton', 'wt', 'phase33-orient-dogfood.meta.json'))
    && !existsSync(join(REPO, '.baton', 'runtime', worker.id))
    && git(['branch', '--list', 'baton/phase33-orient-dogfood']) === '', 'worker resource reap');
  const events = driver.log.read(worker.id);
  const checks = {
    pushAcknowledged: pushed.ok === true && pushed.result === 'ok',
    exactSlice: pushed.sliceDigest === served?.payload?.message?.slice?.refs?.[0]?.digest,
    addressedWorker: served?.worker === worker.id && served?.taskId === 'phase33-orient-dogfood' && served?.runId === 'phase33-orientation',
    typedMapDelivered: served?.payload?.message?.kind === 'baton.orientation.slice' && served?.payload?.message?.slice?.payload?.some((item) => item.path === 'impl/src/cartographer-quartermaster.mjs'),
    hostPathWithheld: served?.payload?.message?.slice?.refs?.every((ref) => !Object.hasOwn(ref, 'path')) === true,
    actorPreserved: served?.actor === 'orchestrator',
    killConfirmed: ['confirmed', 'already_dead'].includes(stopped.result),
    worktreeGone: !existsSync(join(REPO, '.baton', 'wt', 'phase33-orient-dogfood')),
    metadataGone: !existsSync(join(REPO, '.baton', 'wt', 'phase33-orient-dogfood.meta.json')),
    runtimeGone: !existsSync(join(REPO, '.baton', 'runtime', worker.id)),
    branchGone: git(['branch', '--list', 'baton/phase33-orient-dogfood']) === '',
  };
  summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), atlasEpoch: built.provenance.index_epoch, workerId: worker.id, fence, pushed, stopped, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(HERE, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (driver && worker) await driver.coordinator.kill(worker.id, 'policy').catch(() => {});
  rmSync(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify({ pass: summary?.pass ?? false, checks: summary?.checks ?? null }, null, 2));
if (!summary?.pass) process.exitCode = 1;
