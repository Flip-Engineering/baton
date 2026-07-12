#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase32-local-'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
mkdirSync(HERE, { recursive: true });

let summary;
try {
  const atlas = new AtlasCodeIndex({ artifactRoot: join(scratch, 'atlas') });
  const built = await atlas.invoke('index.build', {}, { actor: 'orchestrator', baseRoot: REPO, budgetTokens: 100_000 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: join(scratch, 'orientation') });
  const driver = createDriver({
    repoRoot: REPO, logDir: join(scratch, 'driver'), adapters: {},
    capabilityFactories: { 'cartographer-quartermaster': () => capability },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: REPO } },
    maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 512 * 1024,
  });
  const ctx = { actor: 'orchestrator', budgetTokens: 8_000 };
  const epoch = built.provenance.index_epoch;
  const briefArgs = { indexEpoch: epoch, focus: 'CartographerQuartermaster seedEvidence artifact integrity', shape: 'brief' };
  const brief = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'orientation.slice', briefArgs, ctx);
  const reuseArgs = { indexEpoch: epoch, need: 'CartographerQuartermaster internal reuse capability' };
  const reuse = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.internal', reuseArgs, ctx);
  const missNeed = `unindexed-${randomUUID()}`;
  const miss = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.internal', { indexEpoch: epoch, need: missNeed }, ctx);
  const boundedArgs = { indexEpoch: epoch, focus: 'impl/src/cartographer', shape: 'map' };
  const bounded = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'orientation.slice', boundedArgs, { ...ctx, budgetTokens: 1 });
  const pages = []; let resumed = bounded;
  while (resumed.status === 'needs_resume') {
    resumed = await driver.coordinator.resumeCapability('cartographer-quartermaster', 'orientation.slice', resumed.refs[0], resumed.cursor, ctx);
    pages.push(resumed);
    if (pages.length > 100) throw new Error('bounded orientation did not converge');
  }
  const reverified = await driver.coordinator.reverifyCapability('cartographer-quartermaster', 'orientation.slice', brief, briefArgs, ctx);
  const cards = driver.coordinator.capabilityCards();
  const events = driver.log.read('hub-capability');
  const checks = {
    exactAtlasEpoch: brief.provenance.index_epoch === epoch && reuse.provenance.index_epoch === epoch,
    implementationOriented: brief.payload.some((item) => item.path === 'impl/src/cartographer-quartermaster.mjs'),
    internalReuseGrounded: reuse.payload[0]?.recommendation === 'internal' && reuse.payload[0]?.candidates.some((item) => item.path === 'impl/src/cartographer-quartermaster.mjs'),
    missDoesNotInventSupply: miss.payload[0]?.recommendation === 'external_vet_required' && miss.payload[0]?.candidates.length === 0 && !JSON.stringify(miss).includes('packageName'),
    boundedResume: bounded.status === 'needs_resume' && resumed.status === 'ok' && pages.flatMap((page) => page.payload).some((item) => item.path === 'impl/src/cartographer-quartermaster.mjs'),
    exactReverify: reverified.status === 'ok' && reverified.payload[0]?.ok === true,
    soleCapabilityPlane: cards.length === 1 && cards[0].name === 'cartographer-quartermaster' && cards[0].actions.invoke && cards[0].actions.resume && cards[0].actions.reverify,
    durableAudit: events.length === (5 + pages.length) * 2 && events.every((event) => ['capability.op.started', 'capability.op.completed'].includes(event.kind)) && driver.coordination.snapshot().evidence.length === events.length,
    noWorkerSideEffects: driver.coordinator.list().length === 0,
  };
  summary = {
    at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), worktreeStatus: git(['status', '--short']),
    implementationDigest: sha(readFileSync(join(REPO, 'impl/src/cartographer-quartermaster.mjs'))),
    atlasEpoch: epoch, checks, pass: Object.values(checks).every(Boolean),
    claims: {
      brief: { status: brief.status, digest: brief.refs[0].digest, paths: brief.payload.map((item) => item.path) },
      reuse: { status: reuse.status, digest: reuse.refs[0].digest, recommendation: reuse.payload[0]?.recommendation, paths: reuse.payload[0]?.candidates.map((item) => item.path) },
      miss: { status: miss.status, digest: miss.refs[0].digest, recommendation: miss.payload[0]?.recommendation },
      bounded: { status: bounded.status, digest: bounded.refs[0].digest, cursor: bounded.cursor, resumePages: pages.length, resumedStatus: resumed.status },
      reverified: reverified.payload[0],
    },
  };
  writeFileSync(join(HERE, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify({ pass: summary?.pass ?? false, checks: summary?.checks ?? null }, null, 2));
if (!summary?.pass) process.exitCode = 1;
