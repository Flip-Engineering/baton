// head-probe.mjs — establish the RED/GREEN ground truth at the current head for the
// row-cadence contract items (leg-b activity honesty, settle pacing, stop-outline basis).
// Runs standalone: `node docs/reference/evidence/no-clock-followons-2026-08-15/wave-g/probes/head-probe.mjs`
// Prints one JSON block per probe; exit 0 on completion (probes are observational, not gating).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bindBaton, createDriver } from '../../../../../../impl/src/index.mjs';
import { BatonApplication } from '../../../../../../impl/src/application.mjs';
import { MockAdapter } from '../../../../../../impl/src/adapter.mjs';

const repoId = 'repo-row-cadence-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-rowcadence-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Probe', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'probe', principalId: id, sessionId: `session-${id}` });
}

// A worker that stays working for a long delay (never completes during the probe) and lets
// the probe inject content.tool_call observations through the REAL coordinator event lane —
// exactly what a live provider tool execution surfaces (no checkpoints, ever).
function makeToolOnlyAdapter() {
  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed', delayMs: 120_000 } });
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'probe', refreshedAt: null } });
  const realOnEvent = worker.onEvent.bind(worker);
  let registeredCb = null;
  worker.onEvent = (fn) => { registeredCb = fn; return realOnEvent(fn); };
  globalThis.__rowCadenceInjectToolCall = (workerId, seq) => registeredCb?.({
    worker: workerId, harness: 'worker', turnEpoch: 1, actor: 'worker',
    kind: 'content.tool_call', payload: { phase: 'start', tool: 'bash', seq: seq ?? 0 },
  });
  return worker;
}

async function buildFixture() {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const worker = makeToolOnlyAdapter();
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { worker },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low'],
        effectClasses: ['repository_edit', 'provider_call'],
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
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'worker', model: 'm', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
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

// The wave driver's own stall marker: sha256 of the cursor-stripped status view, minus the
// derived liveness fields exactly as wave-driver.mjs stallMarker() strips them.
function stallMarker(response) {
  const view = { ...(response ?? {}) };
  delete view.cursor;
  delete view.progressClass;
  delete view.requiredAction;
  delete view.waitingOn;
  return createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
}

async function until(check, label, timeoutMs = 20_000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(pollMs);
  }
}

async function probeLegB() {
  const { application, repo, logDir } = await buildFixture();
  const out = {};
  try {
    const runId = 'run-rowcadence-1';
    const proposed = await application.command('run.start', { intent: {
      runId, objective: 'row-cadence leg-b probe', route: { harness: 'worker', model: 'm', effort: 'low' },
    } }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
    await until(async () => {
      const view = await application.command('run.status', { runId }, principal('owner'));
      return view.phase === 'running';
    }, 'the member enters running', 15_000, 50);
    const owner = principal('owner');

    const before = await application.command('run.status', { runId }, owner);
    out.beforePhase = before.phase;
    out.beforeProgressClass = before.progressClass?.class ?? before.progressClass ?? null;
    out.beforeActivity = before.activity ?? null;
    out.beforeMarker = stallMarker(before);

    // Inject a mid-turn tool_call observation through the real event lane — no checkpoint,
    // no message — the exact leg-b case (a tool-calling member with zero pauses).
    globalThis.__rowCadenceInjectToolCall?.('w-1', 1);
    await sleep(300);
    const after = await application.command('run.status', { runId }, owner);
    out.afterPhase = after.phase;
    out.afterProgressClass = after.progressClass?.class ?? after.progressClass ?? null;
    out.afterActivity = after.activity ?? null;
    out.afterMarker = stallMarker(after);
    out.markerAdvanced = out.afterMarker !== out.beforeMarker;
    out.legBClassifiesNonSilent = out.afterProgressClass !== 'silent';

    const insp = await application.command('run.inspect', { runId, depth: 'outline' }, owner);
    const outline = insp?.outline ?? insp ?? {};
    out.outlineLastProgressAt = outline.lastProgress?.at ?? null;
    out.outlineSilenceMs = outline.silenceMs ?? null;
    out.outlineProgressClass = outline.progressClass?.class ?? outline.progressClass ?? null;

    // The quiescence predicate's source: outline.lastProgress.at must be >= the last injected
    // tool_call ts (the interpreter re-arms on an observed advance).
    const { readFileSync } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    let lastToolCallTs = null;
    try {
      for (const l of readFileSync(joinPath(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
        try {
          const e = JSON.parse(l);
          if (e.kind === 'evidence.mapped' && e.payload?.kind === 'content.tool_call' && e.ts > (lastToolCallTs ?? '')) lastToolCallTs = e.ts;
        } catch { /* skip */ }
      }
    } catch { /* coordination events absent */ }
    out.lastToolCallTs = lastToolCallTs;
    out.lastProgressAdvancesPastToolCall = out.outlineLastProgressAt !== null && lastToolCallTs !== null
      && Date.parse(out.outlineLastProgressAt) >= Date.parse(lastToolCallTs);
  } finally {
    await application.close?.().catch(() => {});
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
  return out;
}

export { probeLegB, stallMarker, buildFixture, sleep, until, principal };
