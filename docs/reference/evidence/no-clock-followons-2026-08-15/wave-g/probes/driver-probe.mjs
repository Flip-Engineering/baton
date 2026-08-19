// driver-probe.mjs — drive a REAL wave through createWaveDriver at the current head and
// observe (a) the per-member stop outline's reason (contract item 4), (b) the settle
// timeout's effect on member terminality (contract item 2), (c) the drive loop's basis when
// members fail to start (contract item 5). Observational; prints JSON; exit 0.
//   node docs/reference/evidence/no-clock-followons-2026-08-15/wave-g/probes/driver-probe.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWaveDriver } from '../../../../../../impl/src/wave-driver.mjs';
import { bindBaton, createDriver } from '../../../../../../impl/src/index.mjs';
import { BatonApplication } from '../../../../../../impl/src/application.mjs';
import { MockAdapter } from '../../../../../../impl/src/adapter.mjs';

const repoId = 'repo-row-cadence-driver-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `baton-rowcadence-drv-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Probe', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
};
const principal = (id) => Object.freeze({ actor: 'probe', principalId: id, sessionId: `session-${id}` });

async function buildFixture(adapterConfig) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const worker = adapterConfig ?? new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed' } });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { worker },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'worker', model: 'm', effort: 'low' }],
        capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  const baton = bindBaton(application, principal('run-owner'));
  return { application, driver, baton, repo, logDir };
}

// A worker that never completes: it is mid-turn applying a slow edit for the whole probe.
function slowWorker() {
  const worker = new MockAdapter({
    harness: 'worker',
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'work.txt', content: 'work\n', delayMs: 60_000 }],
    },
  });
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'probe', refreshedAt: null } });
  return worker;
}

// A worker whose spawn always throws — every member fails to start (the drive-loop
// failedToStart path).
function failingWorker() {
  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed' } });
  const realSpawn = worker.spawn.bind(worker);
  worker.spawn = async (...args) => ({ ok: false, code: 'probe_spawn_refused', reason: 'probe: spawn refused' });
  void realSpawn;
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'probe', refreshedAt: null } });
  return worker;
}

async function probeStopBasis() {
  const { application, baton, repo, logDir } = await buildFixture(slowWorker());
  const out = {};
  try {
    const driver = createWaveDriver(baton, {
      steering: 'none',
      finalization: 'none',
      pollIntervalMs: 50,
      stallTimeoutMs: 600,
      settleTimeoutMs: 200,
      unproductiveNudgeBudget: 1,
      saltObjectives: false,
      preflight: false,
      settlement: 'none',
    });
    const receipt = await driver.run({
      members: [{ role: 'alpha', objective: 'stall probe member', exact: { harness: 'worker', model: 'm', effort: 'low' }, scope: ['**'] }],
    });
    out.basis = receipt.basis;
    out.stopReason = receipt.stopReason ?? null;
    out.stop = receipt.stops?.[0] ?? null;
    // The ledger's run.stop_admitted reasonDigest — the digest of the exact reason each member
    // stop carried. Compare against digest(stopReason) and digest('Wave driver settled.').
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    };
    const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
    out.ledgerStopReasonDigests = [];
    try {
      for (const line of readFileSync(joinPath(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.kind === 'run.stop_admitted' && typeof event.payload?.reasonDigest === 'string') {
            out.ledgerStopReasonDigests.push(event.payload.reasonDigest);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* coordination events absent */ }
    out.stopReasonMatchesLedger = out.stopReason !== null
      && out.ledgerStopReasonDigests.some((value) => value === digest(out.stopReason));
    out.ledgerDigestIsBareConstant = out.ledgerStopReasonDigests.some((value) => value === digest('Wave driver settled.'));
    // The stop outline the member saw: re-open the run and read its terminal view.
    const runId = receipt.stops?.[0]?.role ?? null;
    if (runId) {
      const owner = principal('owner');
      try {
        const runs = await application.command('runs.list', {}, owner);
        const run = runs.items?.find((item) => item.objective?.includes('stall probe member'));
        if (run) {
          const view = await application.command('run.status', { runId: run.id }, owner);
          out.memberPhase = view.phase;
          out.memberStopState = view.stop?.state ?? null;
        }
      } catch (error) { out.memberReadError = String(error?.message ?? error); }
    }
  } finally {
    await application.close?.().catch(() => {});
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
  return out;
}

async function probeSettlePacing() {
  const { application, baton, repo, logDir } = await buildFixture(slowWorker());
  const out = {};
  try {
    const driver = createWaveDriver(baton, {
      steering: 'none',
      finalization: 'none',
      pollIntervalMs: 50,
      stallTimeoutMs: 600,
      settleTimeoutMs: 150,
      unproductiveNudgeBudget: 1,
      saltObjectives: false,
      preflight: false,
      settlement: 'none',
    });
    const startedAt = Date.now();
    const receipt = await driver.run({
      members: [{ role: 'alpha', objective: 'settle pacing probe member', exact: { harness: 'worker', model: 'm', effort: 'low' }, scope: ['**'] }],
    });
    out.elapsedMs = Date.now() - startedAt;
    out.basis = receipt.basis;
    out.outcomes = receipt.outcomes.map((row) => ({ role: row.role, phase: row.phase, terminal: row.terminal }));
    out.settleTimeoutExpiredWhileWorking = out.outcomes.some((row) => row.terminal !== true);
  } finally {
    await application.close?.().catch(() => {});
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
  return out;
}

async function probeFailedToStart() {
  const { application, baton, repo, logDir } = await buildFixture(failingWorker());
  const out = {};
  try {
    const driver = createWaveDriver(baton, {
      steering: 'none',
      finalization: 'none',
      pollIntervalMs: 50,
      stallTimeoutMs: 800,
      settleTimeoutMs: 200,
      unproductiveNudgeBudget: 1,
      saltObjectives: false,
      preflight: false,
      settlement: 'none',
    });
    const receipt = await driver.run({
      members: [{ role: 'alpha', objective: 'start-fail probe member', exact: { harness: 'worker', model: 'm', effort: 'low' }, scope: ['**'] }],
    });
    out.basis = receipt.basis;
    out.outcomes = receipt.outcomes.map((row) => ({ role: row.role, phase: row.phase, terminal: row.terminal, terminalCause: row.terminalCause ?? null }));
  } finally {
    await application.close?.().catch(() => {});
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
  return out;
}

const results = {
  stopBasis: await probeStopBasis(),
  settlePacing: await probeSettlePacing(),
  failedToStart: await probeFailedToStart(),
};
console.log(JSON.stringify(results, null, 2));
