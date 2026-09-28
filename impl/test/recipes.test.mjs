// Dynamic workflow composition contract — recipes, invocation manifests (v2) red suite.
//
// Authority: docs/reference/evidence/workflow-composition-2026-07-31/composition-decisions.md —
// the v2 section (and the v2.1 amendment) at the top. This file pins rung RC-A ONLY: the
// normative recipe schema (rule 1, RC-1), the renderer with salt as input (rule 2, RC-2), the
// invocation manifest identity boundary (RC-3), the run-options/digest law (rule 3, RC-5), and
// the `implementContract` preset over a MockAdapter seat (RC-6). Rungs RC-B (attach/redrive
// helpers) and RC-C (redTeamContract/reviewChange presets) are LATER and intentionally absent —
// sequencing is law (rule 5).
//
// The v2.1 acceptance law is the whole point: no new orchestration wave may require a new script
// file. Every bespoke `run-*-wave.mjs` driver script is `baton.recipes.run(recipe, {task, options})`
// with recipe as data + closed run options. `baton.recipes` is an embedded-facade library over the
// shipped `createWaveDriver` — no new application commands, no registry entries, MCP/CLI/web
// untouched (rule 3).
//
// Deterministic: MockAdapter fixtures, fixed repo roots, no live providers.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import {
  admitRecipe, createRecipes, implementContractRecipe, mergeOverrides,
  recipeDigest, renderObjective,
} from '../src/recipes.mjs';

const repoId = 'repo-recipes';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-recipes-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function waveIdFor(idempotencyKey) {
  return `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

// The driver derives waveId from the idempotencyKey alone (wave.mjs:172-179) — the manifest must
// carry the SAME derivation or attach binds the wrong wave.
function validRecipe(overrides = {}) {
  return {
    name: 'write-reports',
    version: '1',
    members: [
      {
        role: 'alpha',
        exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
        scope: ['reports/**'],
        objectiveTemplate: { task: 'Write the report for {task}.', constraints: ['Be concise.', 'Cite the contract.'] },
        report: 'reports/alpha.md',
      },
    ],
    policy: { pollIntervalMs: 20, stallTimeoutMs: 5_000, settleTimeoutMs: 5_000, preflight: false },
    ...overrides,
  };
}

// A host whose MockAdapter spawns one completed member per role, tracking spawns so the started
// member runs are observable (RC-3/RC-6).
function harness(t, scenarios, tracker = { calls: [] }) {
  const repo = root('repo');
  const logDir = root('log');
  const manifestDir = root('manifest');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new MockAdapter({ scenario: scenarios.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'recipes-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenarios).find((key) => key !== 'default' && goal.includes(key));
    tracker.calls.push({ worker, marker: marker ?? 'default' });
    return nativeSpawn(worker, brief, { ...options, scenario: scenarios[marker] ?? scenarios.default });
  };
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
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
    rmSync(manifestDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, logDir, manifestDir, tracker };
}

const scenarios = { alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] } };

// RC-1 (schema): the closed-shape battery — unknown fields, oversize descriptor/task/constraint,
// duplicate roles, non-exact route, function value anywhere in the recipe, all refused with
// corrective field names; a valid recipe deep-freezes.
test('RC-1: the recipe is one normative closed schema — unknown/duplicate/non-exact/function refused; a valid recipe deep-freezes', () => {
  // A valid recipe admits and deep-freezes.
  const recipe = admitRecipe(validRecipe());
  assert.equal(Object.isFrozen(recipe), true, 'the admitted recipe is frozen at the top level');
  assert.equal(Object.isFrozen(recipe.members), true, 'members is frozen');
  assert.equal(Object.isFrozen(recipe.members[0]), true, 'each member is frozen');
  assert.equal(Object.isFrozen(recipe.members[0].exact), true, 'exact route is frozen');
  assert.equal(Object.isFrozen(recipe.members[0].objectiveTemplate), true, 'objectiveTemplate is frozen');
  assert.equal(Object.isFrozen(recipe.policy), true, 'policy is frozen');
  assert.throws(() => { recipe.name = 'mutated'; }, /read only|not extensible|cannot set/iu, 'a frozen field rejects mutation');

  const refused = (mutate, needle) => assert.throws(
    () => admitRecipe(mutate(structuredClone(validRecipe()))),
    (error) => error?.code === 'recipe_schema_invalid' && new RegExp(needle, 'u').test(error.message),
    `expected refusal naming "${needle}"`,
  );

  // Unknown top-level field names itself.
  refused((r) => { r.verison = '1'; return r; }, 'verison');
  // An unknown member field names the field.
  refused((r) => { r.members[0].roole = 'alpha'; return r; }, 'roole');
  // An unknown exact field names the field.
  refused((r) => { r.members[0].exact.provider = 'mock'; return r; }, 'provider');
  // An unknown policy field names the field (R-DC-6: data-only allowlist, no signals).
  refused((r) => { r.policy.signal = null; return r; }, 'signal');
  refused((r) => { r.policy.onProgress = () => {}; return r; }, 'onProgress');
  // verification is REMOVED (no consumer — R-DC-6); it is not a known field.
  refused((r) => { r.verification = { command: 'true' }; return r; }, 'verification');
  // EXACT routes only in v2 — a manual route (harness/model/effort) is non-exact AND unknown.
  refused((r) => { r.members[0] = { role: 'alpha', harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] } }; return r; }, 'exact');

  // The byte caps are gone (#530): an oversize task, an oversize constraint and a descriptor
  // over the old 8 KiB are admitted, as are nine constraints and nine member cards.
  assert.equal(
    admitRecipe(structuredClone(validRecipe({ members: [{ role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 'x'.repeat(2_049), constraints: [] } }] })))
      .members[0].objectiveTemplate.task.length,
    2_049,
    'a 2,049-byte task is admitted — no byte cap refuses it',
  );
  assert.equal(
    admitRecipe(validRecipe({ members: [{ role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: ['y'.repeat(241)] } }] }))
      .members[0].objectiveTemplate.constraints[0].length,
    241,
    'a 241-byte constraint is admitted — no byte cap refuses it',
  );
  assert.equal(
    admitRecipe(validRecipe({ members: [{ role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: Array.from({ length: 9 }, (_, i) => `c${i}`) } }] }))
      .members[0].objectiveTemplate.constraints.length,
    9,
    'nine constraints are admitted — no count ceiling refuses them',
  );
  assert.equal(
    admitRecipe({ name: 'big', version: '1', members: Array.from({ length: 9 }, (_, i) => ({ role: `m${i}`, exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] } })), policy: {} })
      .members.length,
    9,
    'nine member cards are admitted — no count ceiling refuses them',
  );
  assert.equal(
    admitRecipe({ name: 'fat', version: '1', members: Array.from({ length: 8 }, (_, i) => ({ role: `m${i}`, exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 'd'.repeat(1_100), constraints: [] } })), policy: {} })
      .members.length,
    8,
    'a descriptor over the old 8 KiB is admitted — no descriptor cap refuses it',
  );

  // Duplicate roles refuse.
  assert.throws(
    () => admitRecipe({ name: 'dup', version: '1', members: [
      { role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] } },
      { role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] } },
    ], policy: {} }),
    (error) => error?.code === 'recipe_schema_invalid' && /duplicate/u.test(error.message),
    'duplicate roles refuse',
  );

  // Function value anywhere in the recipe refuses (R-DC-6: data, not code) — runtime deep scan.
  // Built inline (no structuredClone — functions are not structurally cloneable, which is the point).
  assert.throws(
    () => admitRecipe({ name: 'fn', version: '1', members: [{ role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] } }], policy: { pollIntervalMs: 20, stallTimeoutMs: 5_000, settleTimeoutMs: 5_000, preflight: () => true } }),
    (error) => error?.code === 'recipe_schema_invalid' && /function/ui.test(error.message),
    'a function value in policy refuses (data, not code)',
  );
  assert.throws(
    () => admitRecipe({ name: 'fn', version: '1', members: [{ role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'], objectiveTemplate: { task: 't', constraints: [] }, report: () => 'x' }], policy: {} }),
    (error) => error?.code === 'recipe_schema_invalid' && /function/ui.test(error.message),
    'a function value in a member refuses (data, not code)',
  );

  // `version` and `name` are required closed strings.
  assert.throws(() => admitRecipe(structuredClone(validRecipe({ name: 5 }))), /name/u, 'a non-string name refuses');
});

// RC-2 (renderer): pinned composition shape; salt is an input (two renders with the same salt are
// identical; different salts differ); the objective lane is the machinery's (issue #368 —
// wave.member.objective from the registry, advisory + pass-through above it, never a refusal).
// The renderer never mints its own salt.
test('RC-2: renderObjective composes the pinned shape with salt as an input — identical salt is identical, different salts differ, the objective rides the registry lane', () => {
  const args = { task: 'Write the report for feature X.', constraints: ['Be concise.', 'Cite the contract.'], salt: 'salt-one', role: 'alpha' };
  const objective = renderObjective(args);
  // Pinned shape: task, then constraint lines, then [attempt: <salt> <role>].
  assert.equal(
    objective,
    'Write the report for feature X.\nBe concise.\nCite the contract.\n[attempt: salt-one alpha]',
    'the renderer composes the pinned shape',
  );
  // Salt is an INPUT — the same salt renders identically; the renderer never mints its own.
  assert.equal(renderObjective(args), renderObjective({ ...args }), 'same inputs render identically');
  assert.notEqual(
    renderObjective(args),
    renderObjective({ ...args, salt: 'salt-two' }),
    'different salts render different objectives',
  );
  assert.ok(
    renderObjective({ ...args, salt: 'salt-two' }).endsWith('[attempt: salt-two alpha]'),
    'the salt line carries the supplied salt and role',
  );
  // The renderer takes NO salt default — omitting it refuses rather than minting one.
  assert.throws(
    () => renderObjective({ task: 't', constraints: [], role: 'alpha' }),
    (error) => error?.code === 'recipe_renderer_invalid' && /salt/u.test(error.message),
    'the renderer refuses to mint its own salt',
  );
  // The objective lane is the machinery's (issue #368): a 5 KB rendered objective — over the
  // retired head cap, under the registry lane — is admitted whole with no advisory.
  const advisories = [];
  const fiveKb = renderObjective({
    task: 'x'.repeat(5_000), constraints: [], salt: 's', role: 'r',
    onAdvisory: (entry) => advisories.push(entry),
  });
  assert.ok(fiveKb.includes('x'.repeat(5_000)), 'a 5 KB rendered objective is admitted whole');
  assert.deepEqual(advisories, [], 'below the registry lane value there is no advisory');
});

// RC-3 (manifest identity): first run mints the manifest (exact rendered members); a same-key retry
// mints again and starts one fresh member run, because the attach retry left the tree with the
// waves.attach surface; a different key mints a fresh manifest/salt/waveId; the manifest round-trips
// its exact members.
test('RC-3: the invocation manifest is the identity boundary — the key-derived waveId and the round-tripped members hold, and a different key mints fresh', async (t) => {
  const { baton, manifestDir, tracker } = harness(t, scenarios);
  const manifestPath = join(manifestDir, 'rc3-alpha.json');
  const recipe = admitRecipe(validRecipe());

  // First run mints the manifest with the exact rendered members.
  tracker.calls.length = 0;
  const first = await baton.recipes.run(recipe, { task: 'feature X', idempotencyKey: 'rc3-key', manifestPath });
  assert.equal(tracker.calls.length, 1, 'the first run starts exactly one member run');
  assert.equal(first.manifest.idempotencyKey, 'rc3-key');
  assert.equal(first.manifest.waveId, waveIdFor('rc3-key'), 'the manifest carries the deterministic idempotencyKey→waveId derivation');
  assert.equal(first.manifest.recipeDigest, recipeDigest(recipe), 'the manifest carries the recipe digest');
  const member = first.manifest.renderedMembers[0];
  assert.equal(member.role, 'alpha');
  assert.deepEqual(member.exact, { harness: 'mock', model: 'mock-model', effort: 'low' });
  assert.deepEqual(member.scope, ['reports/**']);
  assert.ok(member.objective.startsWith('Write the report for feature X.'), 'the rendered objective carries the resolved task');
  assert.ok(member.objective.endsWith(`[attempt: ${first.manifest.salt} alpha]`), 'the rendered objective carries the manifest salt');
  const firstRunIds = (await baton.runs.list()).items.map((item) => item.id).sort();
  assert.equal(firstRunIds.length, 1);

  // Retry with the SAME key: the attach retry left the tree with the waves.attach surface (group A),
  // so the retry mints again and starts one fresh member run. The waveId derives from the key alone,
  // so the identity the manifest carries is unchanged.
  tracker.calls.length = 0;
  const retry = await baton.recipes.run(recipe, { task: 'feature X', idempotencyKey: 'rc3-key', manifestPath });
  assert.equal(tracker.calls.length, 1, 'a same-key retry starts one fresh member run');
  const retryRunIds = (await baton.runs.list()).items.map((item) => item.id).sort();
  assert.equal(retryRunIds.length, 2, 'the retry added one run');
  assert.ok(retryRunIds.some((id) => !firstRunIds.includes(id)), 'the retry produced a new runId');
  assert.equal(retry.manifest.waveId, first.manifest.waveId,
    'the manifest keeps the deterministic idempotencyKey→waveId derivation');
  assert.equal(retry.manifest.idempotencyKey, 'rc3-key', 'the retry keeps the invocation key');

  // A DIFFERENT key mints a fresh manifest/salt/waveId/runIds.
  const manifestPathB = join(manifestDir, 'rc3-beta.json');
  const second = await baton.recipes.run(recipe, { task: 'feature X', idempotencyKey: 'rc3-key-b', manifestPath: manifestPathB });
  assert.notEqual(second.manifest.salt, first.manifest.salt, 'a different key mints a fresh salt');
  assert.notEqual(second.manifest.waveId, first.manifest.waveId, 'a different key mints a fresh waveId');
  const secondRunIds = (await baton.runs.list()).items.map((item) => item.id).sort();
  assert.equal(secondRunIds.length, 3, 'a different key started a fresh run');
  assert.ok(secondRunIds.some((id) => !firstRunIds.includes(id)), 'the fresh key produced a new runId');

  // Manifest round-trip (serialize → read back) preserves the exact members of the last mint.
  const onDisk = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(onDisk.renderedMembers, retry.manifest.renderedMembers, 'the serialized manifest round-trips the exact rendered members');
  assert.equal(onDisk.schemaVersion, 1);
});

// RC-5 (run options): callbacks/evidencePath/overrides never enter the recipe digest; the override
// allowlist merges and re-validates (a post-merge oversize objective refuses before any side
// effect); onDecision passes through unchanged (present only when the bidirectional field exists in
// live code — skipped with an honest note until then).
test('RC-5: run options never enter the digest; the override allowlist merges + re-validates before any side effect; onDecision is accepted and deferred', async (t) => {
  const { baton, manifestDir, tracker } = harness(t, scenarios);
  const base = admitRecipe(validRecipe());
  const baseDigest = recipeDigest(base);

  // callbacks/evidencePath/overrides never enter the recipe digest.
  const manifestPath = join(manifestDir, 'rc5.json');
  const evidencePath = join(manifestDir, 'rc5-evidence.json');
  const receipt = await baton.recipes.run(base, {
    task: 'feature X', idempotencyKey: 'rc5-key', manifestPath, evidencePath,
    callbacks: { onDecision: () => {} },
    overrides: { constraints: ['Added constraint.'], scope: ['reports/**'] },
  });
  assert.equal(receipt.manifest.recipeDigest, baseDigest, 'overrides/callbacks/evidencePath never enter the recipe digest');
  // The override allowlist is CLOSED — an unknown override key refuses.
  await assert.rejects(
    baton.recipes.run(base, { task: 'feature X', idempotencyKey: 'rc5-bad', manifestPath: join(manifestDir, 'rc5-bad.json'), overrides: { task: 'cannot override the task' } }),
    (error) => error?.code === 'recipe_override_unknown',
    'an override outside the {constraints, effort, scope} allowlist refuses',
  );

  // mergeOverrides applies the allowlist: constraints APPEND, effort REPLACE, scope REPLACE.
  const merged = mergeOverrides(base, { constraints: ['extra'], effort: 'high', scope: ['other/**'] });
  assert.deepEqual(merged.members[0].objectiveTemplate.constraints, ['Be concise.', 'Cite the contract.', 'extra'], 'constraints APPEND');
  assert.equal(merged.members[0].exact.effort, 'high', 'effort REPLACE');
  assert.deepEqual(merged.members[0].scope, ['other/**'], 'scope REPLACE');

  // A post-merge invalid override refuses BEFORE any side effect (re-validation, zero starts).
  tracker.calls.length = 0;
  await assert.rejects(
    baton.recipes.run(base, {
      task: 'feature X', idempotencyKey: 'rc5-invalid', manifestPath: join(manifestDir, 'rc5-invalid.json'),
      overrides: { constraints: ['ok', 42] },
    }),
    (error) => error?.code === 'recipe_override_invalid',
    'a post-merge invalid constraint re-validates and refuses',
  );
  assert.equal(tracker.calls.length, 0, 'the post-merge refusal happened before any runs.start (zero side effects)');
  assert.equal(existsSync(join(manifestDir, 'rc5-invalid.json')), false, 'no manifest was persisted for the refused invocation');

  // onDecision passes through unchanged — present only when the bidirectional field exists in live
  // code. The shipped createWaveDriver has no onDecision policy field yet (bidirectional v2 DRIVER
  // half), so the callback is accepted, carried, and honestly deferred — the run still completes.
  const onDecisionPath = join(manifestDir, 'rc5-ondecision.json');
  let fired = false;
  const od = await baton.recipes.run(base, {
    task: 'feature X', idempotencyKey: 'rc5-ondecision', manifestPath: onDecisionPath,
    callbacks: { onDecision: () => { fired = true; } },
  });
  assert.equal(od.manifest.recipeDigest, baseDigest, 'the onDecision callback never enters the digest');
  assert.equal(fired, false, 'onDecision is accepted + deferred until the bidirectional field lands in live code');
});

// RC-6 (preset): `implementContract` over a MockAdapter seat returns the createWaveDriver receipt
// shape with recipe routes/scopes; a same-key retry mints again and starts one fresh seat.
test('RC-6: implementContract over a MockAdapter seat returns the createWaveDriver receipt shape with recipe routes/scopes', async (t) => {
  const { baton, manifestDir, tracker } = harness(t, scenarios);
  const manifestPath = join(manifestDir, 'rc6.json');

  tracker.calls.length = 0;
  const receipt = await baton.recipes.implementContract({
    task: 'the assigned contract rung',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['impl/**'],
    idempotencyKey: 'rc6-key',
    manifestPath,
    policy: { pollIntervalMs: 20, stallTimeoutMs: 5_000, settleTimeoutMs: 5_000, preflight: false },
  });
  assert.equal(tracker.calls.length, 1, 'the preset starts exactly one implementer seat');

  // createWaveDriver receipt shape: the evidence envelope + driver fields + the manifest.
  for (const field of ['schemaVersion', 'startedAt', 'members', 'outcomes', 'basis', 'salt', 'pumpDrained', 'remainingCount', 'residueUnknown', 'manifest']) {
    assert.ok(field in receipt, `the receipt carries the createWaveDriver field "${field}"`);
  }
  assert.equal(typeof receipt.basis, 'string');
  assert.equal(receipt.outcomes.length, 1);
  assert.match(receipt.outcomes[0].resultSha ?? '', /^[a-f0-9]{40}$/u, 'the implementer seat preserved its result');

  // Recipe routes/scopes ride the manifest.
  assert.deepEqual(receipt.manifest.renderedMembers[0].exact, { harness: 'mock', model: 'mock-model', effort: 'low' }, 'the preset carries the recipe route');
  assert.deepEqual(receipt.manifest.renderedMembers[0].scope, ['impl/**'], 'the preset carries the recipe scope');
  assert.ok(receipt.manifest.renderedMembers[0].objective.includes('the assigned contract rung'), 'the preset objective carries the task');
  assert.equal(receipt.manifest.recipeDigest, recipeDigest(admitRecipe(implementContractRecipe({
    task: 'the assigned contract rung',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['impl/**'],
    policy: { pollIntervalMs: 20, stallTimeoutMs: 5_000, settleTimeoutMs: 5_000, preflight: false },
  }))), 'the preset recipe digest is stable');

  const firstRunIds = (await baton.runs.list()).items.map((item) => item.id).sort();

  // A same-key retry mints again and starts one fresh implementer seat: the attach retry left with
  // the waves.attach surface (group A), and the preset has no path that binds the prior wave.
  tracker.calls.length = 0;
  const retry = await baton.recipes.implementContract({
    task: 'the assigned contract rung',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['impl/**'],
    idempotencyKey: 'rc6-key',
    manifestPath,
    policy: { pollIntervalMs: 20, stallTimeoutMs: 5_000, settleTimeoutMs: 5_000, preflight: false },
  });
  assert.equal(tracker.calls.length, 1, 'a same-key retry starts one fresh implementer seat');
  const retryRunIds = (await baton.runs.list()).items.map((item) => item.id).sort();
  assert.equal(retryRunIds.length, 2, 'the retry added one run');
  assert.equal(retry.manifest.waveId, receipt.manifest.waveId,
    'the manifest keeps the deterministic idempotencyKey→waveId derivation');
});

// The embedded facade is the ONLY surface — baton.recipes is a getter over the shipped driver, not
// a new command family (rule 3 / v2.1 acceptance law).
test('baton.recipes is an embedded facade over the shipped createWaveDriver — no new command surface', (t) => {
  const { baton } = harness(t, scenarios);
  const recipes = baton.recipes;
  assert.ok(recipes && typeof recipes.run === 'function' && typeof recipes.implementContract === 'function');
  assert.equal(Object.isFrozen(recipes), true, 'the facade is frozen');
  // A fresh getter returns a usable facade each access (mirrors get waves()).
  assert.equal(typeof baton.recipes.run, 'function');
});
