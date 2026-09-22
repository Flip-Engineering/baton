// fleet_bakeoff (#126) red suite — N candidates on ONE contract, then a referee judge.
//
// Authority: docs/reference/evidence/dropped-features-2026-08-06/docs-deep-finds.md §2.4 (find #4),
// docs/09-revision-log.md F3, docs/07-roadmap.md M1 ("Optional `fleet_bakeoff` (N vendors, same
// task, judge)"). The cross-review half landed as `semantic_review`; bakeoff was never built.
//
// The shipped recipe drives exactly ONE wave, and a wave starts every member together — a referee
// rendered into the candidates' wave would begin its turn before any candidate produced anything.
// `baton.recipes.bakeoff` is therefore a two-wave composition over the SAME shipped driver: wave 1
// renders N members from ONE contract, wave 2 hands the referee each candidate's result
// coordinates, and the referee's own pinned report comes back on the result roster.
//
// Deterministic: MockAdapter fixtures, a real temporary repository, no providers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const repoId = 'repo-bakeoff';
const CONTRACT = {
  task: 'Answer the shared contract in one report. The contract is your sole work authority.',
  constraints: ['Cite the contract.', 'Be concise.'],
};
const VERDICT = 'rank: beta > alpha > gamma\n';
const CANDIDATES = ['alpha', 'beta', 'gamma'];

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-bakeoff-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // Each run's result capture commits inside its own worktree: without an identity the capture
  // fails and every member settles `provider_crashed`, which would make this suite vacuous.
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'baton@example.test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

/** The rendered objective's own trailer is `[attempt: <salt> <role>]` — the unambiguous marker. */
function roleOf(goal) {
  return /\[attempt: [^\]]*?(\w+)\]\s*$/u.exec(String(goal ?? '').trim())?.[1] ?? 'default';
}

function harness(t, tracker = { calls: [] }) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'bakeoff-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const role = roleOf(brief?.goal);
    tracker.calls.push({ worker, role });
    const verdict = role === 'referee';
    const scenario = {
      outcome: 'completed',
      summary: verdict ? 'referee verdict' : `${role} report`,
      edits: [{
        path: `reports/${verdict ? 'verdict' : role}.md`,
        content: verdict ? VERDICT : `${role} report\n`,
      }],
    };
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: false, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
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
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
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
  const baton = bindBaton(application, principal('recipe-owner'));
  t.after(async () => {
    await application.shutdown(principal('cleanup')).catch(() => {});
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { baton, repo, tracker };
}

const route = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

test('BK-1: a bakeoff runs N members on ONE contract and returns the referee\'s verdict on the roster', async (t) => {
  const { baton, tracker } = harness(t);
  assert.equal(typeof baton.recipes.bakeoff, 'function',
    'baton.recipes.bakeoff is the fleet_bakeoff surface (docs/09 F3, docs/07 M1)');

  const result = await baton.recipes.bakeoff({
    idempotencyKey: 'bk-1',
    contract: CONTRACT,
    candidates: CANDIDATES.map((role) => ({ role, exact: route, scope: ['reports/**'], report: `reports/${role}.md` })),
    referee: { role: 'referee', exact: route, scope: ['reports/**'], report: 'reports/verdict.md' },
    // The settle window bounds the driver's pin read per member (wave.mjs:695-702); a 5 s window
    // turns a busy host into a null resultSha. The row still fails when a member produced no report.
    policy: { steering: 'none', pollIntervalMs: 20, stallTimeoutMs: 30_000, settleTimeoutMs: 30_000, preflight: false },
  });

  // The roster: N candidates in the DECLARED order, each with its own preserved result.
  assert.deepEqual(result.bakeoff.candidates.map((entry) => entry.role), CANDIDATES,
    'the roster carries every candidate in the declared order');
  const shas = result.bakeoff.candidates.map((entry) => entry.resultSha);
  for (const sha of shas) assert.match(sha ?? '', /^[a-f0-9]{40}$/u, 'each candidate preserved its result');
  assert.equal(new Set(shas).size, CANDIDATES.length, 'the candidates ran as distinct generations');

  // ONE contract: every candidate's rendered objective is the same text up to the salt/role trailer.
  const bodies = result.bakeoff.candidates.map((entry) => entry.objective.split('\n').slice(0, -1).join('\n'));
  for (const body of bodies) {
    assert.equal(body, bodies[0], 'every candidate ran the SAME contract text');
    assert.ok(body.includes(CONTRACT.task), 'the contract task reached the candidate objective');
    assert.ok(body.includes(CONTRACT.constraints[0]), 'the contract constraints reached the candidate objective');
  }
  assert.equal(new Set(result.bakeoff.candidates.map((entry) => entry.objective)).size, CANDIDATES.length,
    'only the salt/role trailer distinguishes the candidate objectives');

  // The referee judged the SAME candidates: its objective names each one and carries its report.
  const refereeObjective = result.bakeoff.referee.objective;
  for (const [index, role] of CANDIDATES.entries()) {
    assert.ok(refereeObjective.includes(role), `the referee objective names candidate ${role}`);
    assert.ok(refereeObjective.includes(shas[index]), `the referee objective carries ${role}'s result location`);
    assert.ok(refereeObjective.includes(`${role} report`), `the referee objective carries ${role}'s report`);
  }

  // The roster carries the referee's verdict itself — its own pinned report, not a narration of it.
  const referee = result.bakeoff.referee;
  assert.equal(referee.verdict, VERDICT,
    `the roster carries the referee's verdict (phase ${referee.phase}, result ${referee.resultSha}, reason ${referee.verdictReason})`);
  assert.equal(result.bakeoff.referee.report, 'reports/verdict.md');
  assert.equal(result.bakeoff.referee.verdictReason, null, 'the verdict was read, not substituted');

  // Wave 2 is a run of its own: the referee is a member of the bakeoff, never a candidate.
  assert.equal(tracker.calls.filter((call) => call.role === 'referee').length, 1);
  for (const role of CANDIDATES) {
    assert.equal(tracker.calls.filter((call) => call.role === role).length, 1, `${role} ran exactly once`);
  }
});

test('BK-2: the bakeoff spec is closed — an unknown option, a lone candidate and a referee without a report all refuse', async (t) => {
  const { baton } = harness(t);
  const base = {
    idempotencyKey: 'bk-2',
    contract: CONTRACT,
    candidates: CANDIDATES.slice(0, 2).map((role) => ({ role, exact: route, scope: ['reports/**'], report: `reports/${role}.md` })),
    referee: { role: 'referee', exact: route, scope: ['reports/**'], report: 'reports/verdict.md' },
  };
  await assert.rejects(baton.recipes.bakeoff({ ...base, protocol: 'v2' }),
    (error) => error.code === 'recipe_options_invalid' && /"protocol" is unknown/u.test(error.message),
    'an unknown bakeoff option refuses with the option named');
  await assert.rejects(baton.recipes.bakeoff({ ...base, candidates: base.candidates.slice(0, 1) }),
    (error) => error.code === 'recipe_schema_invalid' && /at least 2 candidates/u.test(error.message),
    'a bakeoff of one is not a bakeoff');
  await assert.rejects(baton.recipes.bakeoff({ ...base, referee: { role: 'referee', exact: route, scope: ['reports/**'] } }),
    (error) => error.code === 'recipe_schema_invalid' && /requires "report"/u.test(error.message),
    'a referee without a verdict artifact refuses');
  await assert.rejects(baton.recipes.bakeoff({ ...base, contract: { task: 'x', constraints: [], extra: 1 } }),
    (error) => error.code === 'recipe_schema_invalid',
    'the contract rides the shipped member-template gate, unknown fields included');
});
