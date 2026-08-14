// demo-driver.mjs — the coordinator's live two-phase dogfood of the WF-1 phase grammar.
// [attempt: e354aeda-f975-4520-83a6-7533eb6ff998 coordinator]
//
// Authored by the coordinator (this is NOT part of any row's file partition). It drives the
// two-phase demo wave (`demo-two-phase.wavefile`) through the landed phase compiler + interpreter
// over a real mock-adapter stack (the workflow-as-data-red fixture idiom), then dumps the receipt
// (outcomes + steering) and the coordination-store wave events so the acceptance can cite them.
//
// Usage (run from the SCRATCH TREE ROOT that carries the phase impls — the driver is copied there):
//   node redrive5/demo-driver.mjs <repo-root> <out-dir> <wavefile-path>
//
//   <repo-root>      the scratch git repo the demo wave runs against (created here if absent)
//   <out-dir>        where the receipt/events JSON + the materialized demo files land
//   <wavefile-path>  the demo wavefile in the NEW grammar
//
// Hermetic: in-process MockAdapter, mkdtemp repos, no network, no real provider.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication } from './impl/src/application.mjs';
import { MockAdapter } from './impl/src/adapter.mjs';
import { bindBaton, createDriver } from './impl/src/index.mjs';
import * as dslModule from './impl/src/workflow-dsl.mjs';
import * as interpreterModule from './impl/src/workflow-interpreter.mjs';

const REPO = 'repo-phase-grammar-demo';

// ---- test-fixture helpers (workflow-as-data-red.test.mjs, folded) ----
function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-pgdemo-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

// ---- the demo marker adapter: phase A writes demo-a-outcome.md; phase B writes demo-b-ran.md ----
class DemoMarkerAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this.calls = { spawn: [] };
  }
  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'phase-grammar-demo', refreshedAt: null,
      },
    };
  }
  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }
  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker]
      ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    this.calls.spawn.push({ worker, marker, at: Date.now() });
    if (scenario.carryAttemptMarker) {
      this._carryMarker = this._carryMarker ?? new Map();
      const goal = brief?.goal ?? '';
      const salt = /^\[attempt: [^\]]+\] /u.exec(goal);
      this._carryMarker.set(worker, salt ? salt[0] : '[attempt: missing] ');
    }
    return super.spawn(worker, brief, { ...options, scenario });
  }
  async _applyEdit(session, edit) {
    const salt = this._carryMarker?.get(session.worker);
    if (salt) edit = { ...edit, content: `${salt}${edit.content}` };
    return super._applyEdit(session, edit);
  }
}

async function buildFixture(repo) {
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const coordAdapter = new DemoMarkerAdapter({
    harness: 'mock',
    scenariosByMarker: {
      'writer-a': {
        outcome: 'completed',
        carryAttemptMarker: true,
        edits: [{ path: 'demo-a-outcome.md', content: 'outcome: pass\n' }],
      },
      'writer-b': {
        outcome: 'completed',
        carryAttemptMarker: true,
        edits: [{ path: 'demo-b-ran.md', content: 'phase B ran — gated on demo-a.verdict == "pass"\n' }],
      },
    },
  });
  const logDir = root('log');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('pgdemo-planner'),
      dispatcher: principalOf('pgdemo-dispatcher'),
      observer: principalOf('pgdemo-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('pgdemo-owner'));
  const shutdown = async () => {
    try { await application.shutdown(principalOf('pgdemo-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  };
  return { application, baton, driver, repo, adapter: coordAdapter, coordination: driver.coordination, shutdown, logDir };
}

function writeObjective(repo, role, text) {
  const path = join(repo, 'objectives', `${role}.md`);
  writeFileSync(path, `${text}\n(marker:${role})\n`);
  return path;
}

function compile(text, repoRoot) {
  // D1: the phase compile is the same function reaching the v2 branch; compilePhaseFile is the
  // named entry. Try both so the driver is robust to the impl's exact export surface.
  const cwf = dslModule.compileWavefile;
  if (typeof cwf === 'function') {
    try {
      const out = cwf(text, { repoRoot });
      if (out && out.schemaVersion === 2) return out;
      if (out && out.schemaVersion === 1) return out; // phase-less fallthrough (unexpected here)
    } catch (error) {
      if (typeof dslModule.compilePhaseFile !== 'function') throw error;
    }
  }
  if (typeof dslModule.compilePhaseFile === 'function') return dslModule.compilePhaseFile(text, { repoRoot });
  throw new Error('no phase compiler export found (compileWavefile / compilePhaseFile)');
}

async function main() {
  const [, , repoArg, outArg, wavefileArg] = process.argv;
  const repo = repoArg && existsSync(repoArg) ? repoArg : root('repo');
  const outDir = outArg ?? '.';
  const wavefilePath = wavefileArg ?? 'redrive5/demo-two-phase.wavefile';
  mkdirSync(outDir, { recursive: true });

  writeObjective(repo, 'writer-a', 'Write demo-a-outcome.md carrying an `outcome: pass` line.');
  writeObjective(repo, 'writer-b', 'Write demo-b-ran.md — you are gated on demo-a.verdict == "pass".');

  const text = readFileSync(wavefilePath, 'utf8');
  const compiled = compile(text, repo);
  assert.equal(compiled.schemaVersion, 2, 'a phase-bearing wavefile compiles to a schemaVersion-2 spec');
  assert.ok(Array.isArray(compiled.phases) && compiled.phases.length === 2, 'two phases compiled');

  const fx = await buildFixture(repo);
  try {
    const lane = typeof fx.baton?.recipes?.runWorkflow === 'function'
      ? fx.baton.recipes.runWorkflow
      : interpreterModule.runWorkflow.bind(null, fx.baton);
    assert.equal(typeof lane, 'function', 'runWorkflow lane is available');
    const receipt = await lane(compiled, { driver: LANE_DRIVER, detach: false });

    // The store wave events (wave.started / wave.closed), with their event ids.
    const allEvents = fx.coordination?.events?.() ?? [];
    const storeEvents = allEvents
      .filter((e) => e?.kind === 'wave.started' || e?.kind === 'wave.closed'
        || (e?.kind === 'driver.recorded' && ['wave.started', 'wave.closed'].includes(e?.payload?.kind)))
      .map((e) => ({ seq: e.seq, kind: e.kind, pkind: e?.payload?.kind ?? null, waveId: e?.payload?.waveId ?? null, roster: e?.payload?.roster ?? null }));

    // Materialize the demo files recovered by the harvest.
    for (const entry of receipt.harvest ?? []) {
      if (entry.ok && typeof entry.bytes === 'string') {
        writeFileSync(join(outDir, entry.path), entry.bytes);
      }
    }
    const bundle = {
      compiled,
      receipt,
      storeEvents,
      spawnOrder: fx.adapter.calls.spawn.map((s) => ({ marker: s.marker, at: s.at })),
    };
    writeFileSync(join(outDir, 'demo-receipt.json'), JSON.stringify(bundle, null, 2));
    console.log(JSON.stringify(bundle, null, 2));
  } finally {
    await fx.shutdown();
    rmSync(fx.logDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('DEMO_FAILED', error?.stack ?? error);
  process.exit(1);
});
