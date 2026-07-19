import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as batonModule from '../src/index.mjs';

const { DEFAULT_WORKER_POLICY_REQUEST, MockAdapter } = batonModule;
const factoryAvailable = typeof batonModule.openBaton === 'function';

function repository(name) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase78-${name}-`));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true,
    scripts: { test: 'node --test' },
  }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function exactAdapter(harness, model, efforts, scenario = {
  outcome: 'completed', delayMs: 10, summary: `${harness} complete`, files: {},
}) {
  const adapter = new MockAdapter({
    harness,
    scenario,
  });
  const rawCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...rawCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: model, available: [model], family: harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: efforts,
      serviceTier: null, provenance: 'phase78-test', refreshedAt: null,
    },
    permissions: {
      mode: 'unattended-full',
      boundary: 'Test card models full same-UID host access without claiming OS containment',
    },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: ['test-unattended'],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: ['test-full-access'],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return adapter;
}

const routes = Object.freeze([
  Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' }),
  Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' }),
  Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' }),
]);

function advanced(name, selectedRoutes = routes) {
  const adapters = {};
  for (const route of selectedRoutes) {
    const key = route.provider ? `${route.harness}:${route.provider}` : route.harness;
    adapters[key] = exactAdapter(route.harness, route.model, [route.effort]);
  }
  return {
    deploymentRoot: mkdtempSync(join(tmpdir(), `baton-phase78-${name}-deployment-`)),
    adapters,
    routes: selectedRoutes,
    verification: { command: 'node', arguments: ['--test'] },
    capacity: {
      estimate: () => ({ bytes: 60, inodes: 5 }),
      observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    },
  };
}

const open = (options) => batonModule.openBaton(options);

test('DF0: the public entry point exports openBaton as the one deployment factory', () => {
  assert.equal(
    typeof batonModule.openBaton,
    'function',
    'export openBaton({ repo, advanced? }) from the public entry point',
  );
});

test('DF0b: the ordinary deployment namespace does not reinterpret incompatible v1 authority', {
  skip: !factoryAvailable,
}, async (t) => {
  const repo = repository('default-state-version');
  const stale = join(repo, '.git', 'baton', 'application-v1', 'state', 'coordination');
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, 'events.jsonl'), '{"schemaVersion":1,"kind":"legacy-incompatible"}\n');
  const options = advanced('unused-default-state');
  delete options.deploymentRoot;
  const deployment = await open({ repo, advanced: options });
  t.after(async () => { try { await deployment.close(); } catch {} });
  await deployment.ready;
  assert.equal(existsSync(join(repo, '.git', 'baton', 'application-v3', 'state')), true);
  assert.equal(readFileSync(join(stale, 'events.jsonl'), 'utf8'),
    '{"schemaVersion":1,"kind":"legacy-incompatible"}\n');
});

test('DF1: one repository object returns one bound run/open/close deployment surface', {
  skip: !factoryAvailable,
}, async (t) => {
  const deployment = await open({ repo: repository('one-input'), advanced: advanced('one-input') });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.ok(deployment.ready && typeof deployment.ready.then === 'function');
  assert.equal(typeof deployment.card, 'function');
  assert.equal(typeof deployment.run, 'function');
  assert.equal(typeof deployment.open, 'function');
  assert.equal(typeof deployment.close, 'function');
  assert.equal(deployment.client, undefined);
  assert.equal(deployment.application, undefined);
  assert.equal(deployment.driver, undefined);
  await deployment.ready;
});

test('DF2: advanced root injection still produces one private deployment-owned namespace', {
  skip: !factoryAvailable,
}, async (t) => {
  const repo = repository('root');
  const options = advanced('root');
  const deployment = await open({ repo, advanced: options });
  t.after(async () => { try { await deployment.close(); } catch {} });
  await deployment.ready;

  for (const child of ['state', 'runtime', 'evidence']) {
    const path = join(options.deploymentRoot, child);
    assert.equal(existsSync(path), true, child);
    assert.equal(statSync(path).mode & 0o077, 0, `${child} must be owner-only`);
  }
  assert.equal(statSync(options.deploymentRoot).mode & 0o077, 0, 'deployment root must be owner-only');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), '');
});

test('DF3: exact route cards are self-described and multi-route start has no effort fallback', {
  skip: !factoryAvailable,
}, async (t) => {
  const deployment = await open({ repo: repository('routes'), advanced: advanced('routes') });
  t.after(async () => { try { await deployment.close(); } catch {} });
  await deployment.ready;

  const card = deployment.card();
  assert.equal(card.defaults.profile, 'default');
  assert.equal(card.defaults.route, null, 'multi-route deployments must not silently select one effort');
  assert.deepEqual(card.profiles.map((profile) => profile.name), ['default']);
  assert.deepEqual(
    card.profiles[0].routes.map((route) => JSON.stringify(route)).sort(),
    routes.map((route) => JSON.stringify(route)).sort(),
  );
  assert.deepEqual(card.profiles[0].workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  const publicKeys = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      publicKeys.push(key);
      visit(child);
    }
  };
  visit(card);
  for (const privateLimit of [
    'maxAdoptedResults', 'maxFindings', 'maxReportBytes', 'maxWaitMs', 'maxChanges',
    'maxResponseBytes', 'maxScanEvents', 'maxFiles', 'maxBytes', 'maxAttempts', 'timeoutMs',
  ]) {
    assert.equal(publicKeys.includes(privateLimit), false,
      `ordinary deployment card leaked internal guard ${privateLimit}`);
  }

  await assert.rejects(
    deployment.run('Do not silently choose a route'),
    (error) => error?.code === 'application_route_ambiguous' && /model and effort/u.test(error.message),
  );
  await assert.rejects(
    deployment.run('Do not silently choose effort', { model: 'gpt-5.6-sol' }),
    (error) => error?.code === 'application_client_invalid' && /model and effort together/u.test(error.message),
  );
  await assert.rejects(
    deployment.run('Reject an unauthorized tuple', {
      harness: 'codex', model: 'gpt-5.6-sol', effort: 'low',
    }),
    (error) => error?.code === 'application_route_not_allowed',
  );
  const narrowed = await deployment.run('Narrow the repository-wide profile to one file', {
    ...routes[0], scope: ['src/narrowed.mjs'],
  });
  assert.equal((await narrowed.inspect()).outline.phase, 'awaiting_plan_approval');
  await narrowed.stop('Scoped admission test is complete.');
});

test('DF4: Kimi-through-Claude is an assembly selector, not a fourth public route axis', {
  skip: !factoryAvailable,
}, async (t) => {
  const configured = [{
    harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'max',
  }];
  const deployment = await open({
    repo: repository('kimi-claude'),
    advanced: advanced('kimi-claude', configured),
  });
  t.after(async () => { try { await deployment.close(); } catch {} });
  await deployment.ready;
  assert.deepEqual(deployment.card().profiles[0].routes, [
    { harness: 'claude-code', model: 'kimi-k3[1m]', effort: 'max' },
  ]);
});

test('DF5: ordinary options reject driver choreography and advanced is one closed branch', {
  skip: !factoryAvailable,
}, async () => {
  const forbidden = {
    routes,
    adapters: { codex: exactAdapter('codex', 'gpt-5.6-sol', ['xhigh']) },
    repoId: 'caller-selected-repository-authority',
    logDir: '/tmp/caller-log',
    runtimeRoot: '/tmp/caller-runtime',
    evidenceDir: '/tmp/caller-evidence',
    tokenBudget: 1_500_000,
    usdBudget: 25,
    wallMinutes: 30,
    providerTurns: 64,
    exportMaxFiles: 2_000,
    exportMaxBytes: 104_857_600,
    env: { SECRET: 'must-not-enter-the-factory-surface' },
  };
  for (const [field, value] of Object.entries(forbidden)) {
    await assert.rejects(
      Promise.resolve().then(() => open({ repo: repository(`forbidden-${field}`), [field]: value })),
      (error) => error?.code === 'deployment_config_invalid' && error.message.includes(field),
      field,
    );
  }
  await assert.rejects(
    Promise.resolve().then(() => open({
      repo: repository('advanced-unknown'), advanced: { ...advanced('unknown'), tokenBudget: 1 },
    })),
    (error) => error?.code === 'deployment_config_invalid' && error.message.includes('tokenBudget'),
  );
});

test('DF6: deployment close joins callers, drains ownership, and remains idempotent', {
  skip: !factoryAvailable,
}, async () => {
  const deployment = await open({
    repo: repository('close'),
    advanced: advanced('close', [routes[0]]),
  });
  await deployment.ready;
  const [first, concurrent] = await Promise.all([deployment.close(), deployment.close()]);
  const replay = await deployment.close();
  assert.equal(first.state, 'closed');
  assert.deepEqual(first.ownership, { workers: 0, workerIds: [], closed: true });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(replay, first);
  await assert.rejects(
    deployment.run('Closed deployments own no new work', routes[0]),
    (error) => error?.code === 'application_closed',
  );
});

test('DF7: worker worktrees materialize the effective caller tree without importing credentials or mutating the caller', {
  skip: !factoryAvailable,
}, async (t) => {
  const repo = repository('effective-tree');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, '.gitignore'), 'glm_key.json\n');
  writeFileSync(join(repo, 'src', 'staged.mjs'), "export const staged = 'base';\n");
  writeFileSync(join(repo, 'src', 'unstaged.mjs'), "export const unstaged = 'base';\n");
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'source baseline'], { cwd: repo });

  writeFileSync(join(repo, 'src', 'staged.mjs'), "export const staged = 'caller staged';\n");
  execFileSync('git', ['add', 'src/staged.mjs'], { cwd: repo });
  writeFileSync(join(repo, 'src', 'unstaged.mjs'), "export const unstaged = 'caller unstaged';\n");
  writeFileSync(join(repo, 'src', 'untracked.mjs'), "export const untracked = 'caller safe source';\n");
  writeFileSync(join(repo, 'glm_key.json'), '{"glm_key":"ignored-project-secret"}\n');

  const gitBytes = (args) => execFileSync('git', args, { cwd: repo });
  const callerBefore = {
    status: gitBytes(['status', '--porcelain=v1', '-z']),
    indexTree: gitBytes(['write-tree']),
    unstagedDiff: gitBytes(['diff', '--binary']),
    stagedDiff: gitBytes(['diff', '--cached', '--binary']),
    staged: readFileSync(join(repo, 'src', 'staged.mjs')),
    unstaged: readFileSync(join(repo, 'src', 'unstaged.mjs')),
    untracked: readFileSync(join(repo, 'src', 'untracked.mjs')),
    ignoredCredential: readFileSync(join(repo, 'glm_key.json')),
  };

  const route = routes[0];
  const adapter = exactAdapter(route.harness, route.model, [route.effort], {
    outcome: 'completed', delayMs: 10, summary: 'effective tree inspected',
    edits: [{ path: 'worker-output.txt', content: 'worker-owned\n' }],
  });
  let workerTree = null;
  let workerChangedPaths = null;
  let workerBaseSha = null;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => spawn(worker, brief, {
    ...options,
    worktreeReady: Promise.resolve(options.worktreeReady).then((ready) => {
      workerBaseSha = ready.baseSha;
      workerTree = {
        staged: existsSync(join(ready.path, 'src', 'staged.mjs'))
          ? readFileSync(join(ready.path, 'src', 'staged.mjs'), 'utf8') : null,
        unstaged: existsSync(join(ready.path, 'src', 'unstaged.mjs'))
          ? readFileSync(join(ready.path, 'src', 'unstaged.mjs'), 'utf8') : null,
        untracked: existsSync(join(ready.path, 'src', 'untracked.mjs'))
          ? readFileSync(join(ready.path, 'src', 'untracked.mjs'), 'utf8') : null,
        credentialPresent: existsSync(join(ready.path, 'glm_key.json')),
        status: execFileSync('git', ['status', '--porcelain=v1'], {
          cwd: ready.path, encoding: 'utf8',
        }),
      };
      return ready;
    }),
  });
  const applyEdit = adapter._applyEdit.bind(adapter);
  adapter._applyEdit = async (session, edit) => {
    await applyEdit(session, edit);
    workerChangedPaths = execFileSync(
      'git', ['diff', '--name-only', workerBaseSha, 'HEAD'],
      { cwd: session.opts.worktree, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
  };

  const options = advanced('effective-tree', [route]);
  options.adapters = { [route.harness]: adapter };
  const deployment = await open({ repo, advanced: options });
  t.after(async () => { try { await deployment.close(); } catch {} });
  const run = await deployment.run('Add one worker-owned output while preserving the effective caller tree.', route);
  const prepared = await run.complete();
  assert.equal(prepared.outline.phase, 'work_completed');
  assert.equal(prepared.outline.actions.some((action) => action.kind === 'integrate'), true);

  const callerAfter = {
    status: gitBytes(['status', '--porcelain=v1', '-z']),
    indexTree: gitBytes(['write-tree']),
    unstagedDiff: gitBytes(['diff', '--binary']),
    stagedDiff: gitBytes(['diff', '--cached', '--binary']),
    staged: readFileSync(join(repo, 'src', 'staged.mjs')),
    unstaged: readFileSync(join(repo, 'src', 'unstaged.mjs')),
    untracked: readFileSync(join(repo, 'src', 'untracked.mjs')),
    ignoredCredential: readFileSync(join(repo, 'glm_key.json')),
  };
  assert.deepEqual(callerAfter, callerBefore, 'Baton must leave the caller worktree and index untouched');
  assert.notEqual(
    workerTree,
    null,
    `worker worktree never became ready (Run phase: ${run.last?.outline?.phase ?? 'unknown'})`,
  );
  assert.deepEqual(workerTree, {
    staged: "export const staged = 'caller staged';\n",
    unstaged: "export const unstaged = 'caller unstaged';\n",
    untracked: "export const untracked = 'caller safe source';\n",
    credentialPresent: false,
    status: '',
  }, 'the worker must start from a clean private snapshot of the effective caller tree');
  assert.deepEqual(
    workerChangedPaths,
    ['worker-output.txt'],
    'the accepted worker diff must exclude all pre-existing caller changes',
  );
});

test('DF8: one public Claude harness dispatches exact Opus and Kimi tuples only to their private adapters', {
  skip: !factoryAvailable,
}, async (t) => {
  const configured = [
    { harness: 'claude-code', provider: 'claude', model: 'claude-opus-4-6', effort: 'xhigh' },
    { harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'max' },
  ];
  const opus = exactAdapter('claude-code', 'claude-opus-4-6', ['xhigh'], {
    outcome: 'completed', delayMs: 10, summary: 'Opus route completed',
    edits: [{ path: 'opus-result.txt', content: 'opus\n' }],
  });
  const kimi = exactAdapter('claude-code', 'kimi-k3[1m]', ['max'], {
    outcome: 'completed', delayMs: 10, summary: 'Kimi route completed',
    edits: [{ path: 'kimi-result.txt', content: 'kimi\n' }],
  });
  const calls = { opus: [], kimi: [] };
  const opusSpawn = opus.spawn.bind(opus);
  opus.spawn = (...args) => { calls.opus.push(args); return opusSpawn(...args); };
  const kimiSpawn = kimi.spawn.bind(kimi);
  kimi.spawn = (...args) => { calls.kimi.push(args); return kimiSpawn(...args); };
  const options = advanced('claude-private-dispatch', configured);
  options.adapters = { 'claude-code:claude': opus, 'claude-code:kimi': kimi };
  const deployment = await open({
    repo: repository('claude-private-dispatch'), advanced: options,
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.deepEqual(deployment.card().profiles[0].routes, configured.map(({ provider: _, ...route }) => route));
  const opusRun = await deployment.run('Dispatch only to native Claude Opus.', {
    harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh',
  });
  await opusRun.approve();
  assert.equal(calls.opus.length, 1);
  assert.equal(calls.kimi.length, 0);
  assert.equal(calls.opus[0][2].model, 'claude-opus-4-6');
  assert.equal(calls.opus[0][2].reasoningEffort, 'xhigh');

  const kimiRun = await deployment.run('Dispatch only to Kimi through Claude Code.', {
    harness: 'claude-code', model: 'kimi-k3[1m]', effort: 'max',
  });
  await kimiRun.approve();
  assert.equal(calls.opus.length, 1);
  assert.equal(calls.kimi.length, 1);
  assert.equal(calls.kimi[0][2].model, 'kimi-k3[1m]');
  assert.equal(calls.kimi[0][2].reasoningEffort, 'max');
});

test('DF9: built-in GLM advertises only glm-5.2 xhigh and rejects either mixed-catalog ordering before driver effects', {
  skip: !factoryAvailable,
}, async (t) => {
  const repo = repository('glm-built-in');
  writeFileSync(join(repo, 'glm_key.json'), '{"glm_key":"phase78-fixture-key"}\n');
  chmodSync(join(repo, 'glm_key.json'), 0o600);
  const validRoute = { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' };
  const valid = advanced('glm-built-in-valid', [validRoute]);
  delete valid.adapters;
  const deployment = await open({ repo, advanced: valid });
  t.after(async () => { try { await deployment.close(); } catch {} });
  assert.deepEqual(deployment.card().profiles[0].routes, [validRoute]);

  const obsoleteRoute = { harness: 'glm', model: 'glm-4.7', effort: 'xhigh' };
  for (const [label, selectedRoutes] of [
    ['current-first', [validRoute, obsoleteRoute]],
    ['obsolete-first', [obsoleteRoute, validRoute]],
  ]) {
    const rejected = advanced(`glm-mixed-${label}`, selectedRoutes);
    delete rejected.adapters;
    await assert.rejects(
      open({ repo, advanced: rejected }),
      (error) => error?.code === 'deployment_config_invalid'
        && /only glm-5\.2/u.test(error.message),
      label,
    );
    assert.deepEqual(
      readdirSync(join(rejected.deploymentRoot, 'state')),
      [],
      `${label} must refuse before coordination log or writer admission`,
    );
    assert.equal(existsSync(join(rejected.deploymentRoot, 'state', 'coordination')), false);
  }
});

test('DF10: default route inventory omits auth-unready Claude providers without reading or mutating the real home', {
  skip: !factoryAvailable,
}, () => {
  const repo = repository('isolated-home-inventory');
  writeFileSync(join(repo, 'glm_key.json'), '{"glm_key":"phase78-fixture-key"}\n');
  chmodSync(join(repo, 'glm_key.json'), 0o600);
  const isolatedHome = mkdtempSync(join(tmpdir(), 'baton-phase78-isolated-home-'));
  const moduleHref = new URL('../src/index.mjs', import.meta.url).href;
  const script = [
    `const { openBaton } = await import(${JSON.stringify(moduleHref)});`,
    `const deployment = await openBaton({ repo: ${JSON.stringify(repo)} });`,
    'const routes = deployment.card().profiles[0].routes;',
    'await deployment.close();',
    'process.stdout.write(JSON.stringify(routes));',
  ].join('\n');
  const observed = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '--eval', script,
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: isolatedHome },
  }));
  assert.deepEqual(observed, [{ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }]);
  assert.equal(observed.some((route) => route.harness === 'claude-code'), false);
  assert.deepEqual(readdirSync(isolatedHome), [], 'inventory must not create auth state in the isolated home');
});

test('DF10b: default discovery does not advertise a file-present rejected-refresh Kimi route', {
  skip: !factoryAvailable,
}, () => {
  const repo = repository('tombstoned-kimi-inventory');
  const isolatedHome = mkdtempSync(join(tmpdir(), 'baton-phase90-tombstoned-kimi-home-'));
  mkdirSync(join(isolatedHome, '.codex'), { recursive: true });
  writeFileSync(join(isolatedHome, '.codex', 'auth.json'), '{}\n', { mode: 0o600 });
  mkdirSync(join(isolatedHome, '.kimi-code', 'credentials'), { recursive: true });
  mkdirSync(join(isolatedHome, '.kimi-code', 'oauth'), { recursive: true });
  writeFileSync(join(isolatedHome, '.kimi-code', 'config.toml'), '[auth]\nmethod = "oauth"\n');
  writeFileSync(join(isolatedHome, '.kimi-code', 'device_id'), 'phase90-device\n', { mode: 0o600 });
  writeFileSync(join(isolatedHome, '.kimi-code', 'oauth', 'kimi-code'), '');
  writeFileSync(join(isolatedHome, '.kimi-code', 'credentials', 'kimi-code.json'), `${JSON.stringify({
    access_token: '', refresh_token: '', expires_at: 0, expires_in: 0,
    scope: 'fixture', token_type: 'Bearer',
  })}\n`, { mode: 0o600 });
  const moduleHref = new URL('../src/index.mjs', import.meta.url).href;
  const script = [
    `const { openBaton } = await import(${JSON.stringify(moduleHref)});`,
    `const deployment = await openBaton({ repo: ${JSON.stringify(repo)} });`,
    'const routes = deployment.card().profiles[0].routes;',
    'await deployment.close();',
    'process.stdout.write(JSON.stringify(routes));',
  ].join('\n');
  const observed = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '--eval', script,
  ], { encoding: 'utf8', env: { ...process.env, HOME: isolatedHome } }));
  assert.equal(observed.some((route) => route.harness === 'kimi-code'), false);
  assert.equal(observed.every((route) => route.harness === 'codex'), true);
});

test('DF11: concise complete prepares an adopted result and one explicit apply fast-forwards it', {
  skip: !factoryAvailable,
}, async (t) => {
  const repo = repository('apply');
  const route = routes[0];
  const adapter = exactAdapter(route.harness, route.model, [route.effort], {
    outcome: 'completed', delayMs: 10, summary: 'application result prepared',
    edits: [{ path: 'applied-result.txt', content: 'applied through Baton\n' }],
  });
  const options = advanced('apply', [route]);
  options.adapters = { [route.harness]: adapter };
  const deployment = await open({ repo, advanced: options });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.deepEqual(deployment.card().profiles[0].integrationPolicy, {
    mode: 'manual', strategies: ['ff-only', 'structured'],
    requireAdoptedResult: true, requireSemanticReview: false,
  });
  assert.equal(deployment.card().profiles[0].exportPolicy.requireIntegration, true);
  const beforeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const run = await deployment.run('Create one result and apply it through the concise Baton surface.', route);
  const prepared = await run.complete();

  assert.equal(prepared.outline.phase, 'work_completed', JSON.stringify(prepared));
  assert.equal(existsSync(join(repo, 'applied-result.txt')), false,
    'complete must not implicitly edit the caller repository');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), beforeSha);
  const applyAction = prepared.outline.actions.find((action) => action.kind === 'integrate');
  assert.equal(applyAction.label, 'Apply adopted result');
  assert.equal(applyAction.destructive, true);
  assert.equal(applyAction.inputSchema.properties.strategy.default, 'ff-only');

  const applied = await run.apply();
  assert.equal(applied.outline.phase, 'completed');
  assert.equal(existsSync(join(repo, 'applied-result.txt')), true);
  assert.equal(readFileSync(join(repo, 'applied-result.txt'), 'utf8'), 'applied through Baton\n');
  assert.notEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), beforeSha);
});
