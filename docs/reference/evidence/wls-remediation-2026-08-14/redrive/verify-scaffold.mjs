// verify-scaffold.mjs — coordinator verification scaffold for the WLS-1 pin vacuity guard.
// NOT a deliverable; read-and-run instrumentation only. Extends the waves_list fixture so the
// per-member full-log scan path genuinely executes (string-array roster of fake members, no
// steering.registered binds → no-run render, no early refusal), then reports the combined
// events()+eventsView() read count for one waves.list call.
//
// Run: node docs/reference/evidence/wls-remediation-2026-08-14/redrive/verify-scaffold.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication } from '../../../../../impl/src/application.mjs';
import { MockAdapter } from '../../../../../impl/src/adapter.mjs';
import { createDriver } from '../../../../../impl/src/index.mjs';

const REPO = 'repo-waves-list-verify';
const MEMBER_COUNT = 20;

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wls-verify-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
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

async function run() {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: new MockAdapter({ harness: 'mock', scenariosByMarker: { default: { outcome: 'completed' } } }) },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('wls-planner'),
      dispatcher: principalOf('wls-dispatcher'),
      observer: principalOf('wls-observer'),
    },
    authorize: async () => true,
  });

  // Genuine fixture: one OPEN registry row with a string-array roster of MEMBER_COUNT fake
  // members. No steering.registered binds → each member renders as a no-run local row (no
  // early wave_not_found refusal), so the per-member full-log scans execute for every member.
  const waveId = 'wave:verify-scaled';
  const roster = Array.from({ length: MEMBER_COUNT }, (_, i) => `member-${i}`);
  const recorded = driver.coordination.recordDriver('wave.started', {
    waveId,
    roster,
    idempotencyKey: 'verify-scaled-ik',
  }, { actor: 'test', key: `wave.started:${waveId}` });
  if (!recorded?.ok) {
    throw new Error('wave.started record was not accepted: ' + JSON.stringify(recorded));
  }

  // Spy AFTER recording so the record itself does not pollute the read count.
  const coordination = driver.coordination;
  const realEvents = coordination.events.bind(coordination);
  const realView = coordination.eventsView.bind(coordination);
  let eventsCalls = 0;
  coordination.events = (...args) => { eventsCalls += 1; return realEvents(...args); };
  coordination.eventsView = (...args) => { eventsCalls += 1; return realView(...args); };

  let outcome = 'answered';
  let result;
  try {
    result = await application.command('waves.list', {}, principalOf('wls-owner'));
  } catch (error) {
    outcome = `threw:${error?.code ?? error?.message}`;
    result = null;
  }

  const waves = Array.isArray(result?.waves) ? result.waves.length : null;
  const memberCount = waves !== null && result.waves[0] ? result.waves[0].roster?.length : null;

  console.log(JSON.stringify({
    eventsCalls,
    bound: eventsCalls <= 4,
    MEMBER_COUNT,
    outcome,
    waves,
    memberCount,
    rosterRoles: result?.waves?.[0]?.roster?.map((m) => m.role).slice(0, 3),
  }, null, 2));

  try { await application.shutdown(principalOf('wls-cleanup')); } catch { /* best effort */ }
  try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
  try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  rmSync(repo, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
}

run().catch((error) => {
  console.error('verify-scaffold failed:', error);
  process.exit(1);
});
