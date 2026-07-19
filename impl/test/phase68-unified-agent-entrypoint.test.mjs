import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import {
  BATON_CLI_HELP, batonCliHelp, discoverBatonConnection, parseBatonCli, runBatonCli,
} from '../src/application-cli.mjs';
import { bindBaton } from '../src/application-client.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const route = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });

function resolver(routes = [route], defaults = undefined) {
  const application = Object.create(BatonApplication.prototype);
  application.profiles = new Map([['progressive', { routes }]]);
  application.defaults = defaults ?? { profile: 'progressive', route };
  return application;
}

function connectionFixture({ linked = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-connection-'));
  const repo = join(root, 'repo');
  const common = linked ? join(root, 'common.git') : join(repo, '.git');
  const gitDir = linked ? join(common, 'worktrees', 'repo') : common;
  const config = join(root, 'config');
  mkdirSync(join(repo, 'nested'), { recursive: true });
  mkdirSync(join(gitDir, 'baton'), { recursive: true });
  if (linked) {
    writeFileSync(join(repo, '.git'), `gitdir: ${gitDir}\n`);
    writeFileSync(join(gitDir, 'commondir'), '../..\n');
    mkdirSync(join(common, 'baton'), { recursive: true });
  }
  mkdirSync(join(config, 'baton', 'connections'), { recursive: true });
  writeFileSync(join(common, 'baton', 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: 'progressive', repoId: 'repo-private',
  }));
  const tokenFile = join(config, 'baton', 'connections', 'progressive.token');
  writeFileSync(tokenFile, 'private-bearer\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  const profileFile = join(config, 'baton', 'connections', 'progressive.json');
  writeFileSync(profileFile, JSON.stringify({
    schemaVersion: 1, url: 'https://baton.test', origin: 'https://control.test', tokenFile: 'progressive.token',
  }), { mode: 0o600 });
  chmodSync(profileFile, 0o600);
  return { root, repo, common, config, tokenFile, profileFile };
}

test('ordinary CLI is objective-first and manual routing selects model and effort together', () => {
  assert.deepEqual(parseBatonCli(['run', 'Improve Baton', '--idempotency-key', 'run-default']), {
    kind: 'command', name: 'run.start',
    args: { intent: { objective: 'Improve Baton' } },
    idempotencyKey: 'run-default',
  });
  const selected = parseBatonCli([
    'run', 'Improve Baton', '--model', 'gpt-5.6-sol', '--effort', 'high',
    '--idempotency-key', 'run-a',
  ]);
  assert.deepEqual(selected, {
    kind: 'command', name: 'run.start', idempotencyKey: 'run-a',
    args: { intent: { objective: 'Improve Baton', route: { model: 'gpt-5.6-sol', effort: 'high' } } },
  });
  assert.throws(() => parseBatonCli(['run', 'No silent effort', '--model', 'gpt-5.6-sol']),
    (error) => error?.code === 'cli_invalid' && /model and --effort together/u.test(error.message));
  assert.throws(() => parseBatonCli(['run', 'No silent model', '--effort', 'low']),
    (error) => error?.code === 'cli_invalid' && /model and --effort together/u.test(error.message));
});

test('application resolves omitted profile and route from deployment authority', () => {
  const application = resolver();
  assert.deepEqual(application._resolveIntent({ objective: 'Improve Baton' }), {
    runId: null, objective: 'Improve Baton', profile: 'progressive', route, scope: null,
    composition: null,
  });
  assert.deepEqual(application._resolveIntent({
    objective: 'Improve Baton', route: { model: 'gpt-5.6-sol', effort: 'low' },
  }).route, route);
});

test('model-and-effort selection is exact and never inherits a deployment effort default', () => {
  const routes = [
    route,
    { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    { harness: 'glm', model: 'glm-5.2', effort: 'low' },
  ];
  const application = resolver(routes, { profile: 'progressive', route });
  assert.deepEqual(application._resolveIntent({
    objective: 'Use GLM', route: { model: 'glm-5.2', effort: 'low' },
  }).route, routes[2]);
  assert.deepEqual(application._resolveIntent({
    objective: 'Use high effort', route: { model: 'gpt-5.6-sol', effort: 'high' },
  }).route, routes[1]);
  assert.throws(() => application._resolveIntent({
    objective: 'No implicit effort', route: { model: 'gpt-5.6-sol' },
  }), (error) => error?.code === 'application_route_invalid');
  assert.throws(() => application._resolveIntent({
    objective: 'Unknown', route: { model: 'missing', effort: 'low' },
  }),
    (error) => error?.code === 'application_route_not_allowed');
});

test('multi-route objective-only invocation refuses a configured fixed route', () => {
  const routes = [
    route,
    { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  ];
  const application = resolver(routes, { profile: 'progressive', route });
  assert.throws(() => application._resolveIntent({ objective: 'Do not choose low effort' }),
    (error) => error?.code === 'application_route_ambiguous'
      && /select model and effort/u.test(error.message));
});

test('manual model-and-effort selection refuses ambiguous harnesses without default-route tie breaking', () => {
  const routes = [
    route,
    { harness: 'grok', model: route.model, effort: route.effort },
  ];
  const application = resolver(routes, { profile: 'progressive', route });
  assert.throws(() => application._resolveIntent({
    objective: 'Do not choose a harness', route: { model: route.model, effort: route.effort },
  }), (error) => error?.code === 'application_route_ambiguous');
  assert.deepEqual(application._resolveIntent({
    objective: 'Choose the exact harness',
    route: { harness: 'grok', model: route.model, effort: route.effort },
  }).route, routes[1]);
});

test('exact compatibility remains and ordinary help hides deployment policy plumbing', () => {
  const exact = parseBatonCli([
    'run', 'start', 'Improve Baton', '--profile', 'progressive',
    '--exact', 'codex/gpt-5.6-sol@low', '--idempotency-key', 'exact-a',
  ]);
  assert.deepEqual(exact.args.intent, {
    objective: 'Improve Baton', profile: 'progressive', route,
  });
  assert.match(BATON_CLI_HELP, /baton run OBJECTIVE \[--model MODEL --effort EFFORT\]/u);
  for (const leaked of ['--profile PROFILE', 'TOKEN_BUDGET', 'EVIDENCE_OWNER_ROOT', 'EXPORT_MAX_BYTES', 'PROVIDER_TURNS']) {
    assert.equal(BATON_CLI_HELP.includes(leaked), false, leaked);
  }
});

test('nested repository discovery reads a relative token through private Git metadata', () => {
  const { repo, config, common } = connectionFixture();
  assert.deepEqual(discoverBatonConnection({ cwd: join(repo, 'nested'), env: { XDG_CONFIG_HOME: config } }), {
    baseUrl: 'https://baton.test', origin: 'https://control.test', repoId: 'repo-private', token: 'private-bearer',
    authority: 'repository-user-profile', repositoryRoot: repo, profile: 'progressive',
  });
  assert.equal(common, join(repo, '.git'));
});

test('linked worktrees discover the shared Git common-directory selector', () => {
  const { repo, config } = connectionFixture({ linked: true });
  const connection = discoverBatonConnection({ cwd: join(repo, 'nested'), env: { XDG_CONFIG_HOME: config } });
  assert.equal(connection.repositoryRoot, repo);
  assert.equal(connection.repoId, 'repo-private');
  assert.equal(connection.token, 'private-bearer');
});

test('environment compatibility override is complete and never merges semantic authorities', () => {
  const complete = {
    BATON_URL: 'https://legacy.test', BATON_ORIGIN: 'https://origin.test',
    BATON_REPO_ID: 'repo-a', BATON_TOKEN: 'token-a',
  };
  assert.deepEqual(discoverBatonConnection({ cwd: '/unavailable', env: complete }), {
    baseUrl: complete.BATON_URL, origin: complete.BATON_ORIGIN, repoId: complete.BATON_REPO_ID,
    token: complete.BATON_TOKEN, authority: 'environment-compatibility',
  });
  for (const missing of Object.keys(complete)) {
    const partial = { ...complete };
    delete partial[missing];
    assert.throws(() => discoverBatonConnection({ cwd: '/unavailable', env: partial }),
      (error) => error?.code === 'cli_config_invalid' && /incomplete/u.test(error.message));
  }
});

test('user profile and token boundaries refuse relative XDG roots, symlinks, permissions, and foreign owners', () => {
  const relative = connectionFixture();
  assert.throws(() => discoverBatonConnection({ cwd: relative.repo, env: { XDG_CONFIG_HOME: 'relative-config' } }),
    (error) => error?.code === 'cli_config_invalid' && /XDG_CONFIG_HOME must be absolute/u.test(error.message));

  const looseProfile = connectionFixture();
  chmodSync(looseProfile.profileFile, 0o644);
  assert.throws(() => discoverBatonConnection({ cwd: looseProfile.repo, env: { XDG_CONFIG_HOME: looseProfile.config } }),
    (error) => error?.code === 'cli_config_invalid' && /owner-only permissions/u.test(error.message));

  const looseToken = connectionFixture();
  chmodSync(looseToken.tokenFile, 0o640);
  assert.throws(() => discoverBatonConnection({ cwd: looseToken.repo, env: { XDG_CONFIG_HOME: looseToken.config } }),
    (error) => error?.code === 'cli_config_invalid' && /owner-only permissions/u.test(error.message));

  const oversizedProfile = connectionFixture();
  writeFileSync(oversizedProfile.profileFile, ' '.repeat((16 * 1024) + 1), { mode: 0o600 });
  assert.throws(() => discoverBatonConnection({ cwd: oversizedProfile.repo, env: { XDG_CONFIG_HOME: oversizedProfile.config } }),
    (error) => error?.code === 'cli_config_invalid' && /bounded regular non-symlink/u.test(error.message));

  const oversizedToken = connectionFixture();
  writeFileSync(oversizedToken.tokenFile, 'x'.repeat((16 * 1024) + 1), { mode: 0o600 });
  assert.throws(() => discoverBatonConnection({ cwd: oversizedToken.repo, env: { XDG_CONFIG_HOME: oversizedToken.config } }),
    (error) => error?.code === 'cli_config_invalid' && /bounded regular non-symlink/u.test(error.message));

  const invalidToken = connectionFixture();
  const bearerFragment = 'distinctive-bearer-fragment';
  writeFileSync(invalidToken.tokenFile, `${bearerFragment}\nsecond-line\n`, { mode: 0o600 });
  let tokenError;
  try { discoverBatonConnection({ cwd: invalidToken.repo, env: { XDG_CONFIG_HOME: invalidToken.config } }); }
  catch (error) { tokenError = error; }
  assert.equal(tokenError?.code, 'cli_config_invalid');
  assert.equal(tokenError?.message.includes(bearerFragment), false);

  const profileLink = connectionFixture();
  const profileTarget = `${profileLink.profileFile}.target`;
  writeFileSync(profileTarget, JSON.stringify({
    schemaVersion: 1, url: 'https://baton.test', origin: 'https://control.test', tokenFile: 'progressive.token',
  }), { mode: 0o600 });
  unlinkSync(profileLink.profileFile);
  symlinkSync(profileTarget, profileLink.profileFile);
  assert.throws(() => discoverBatonConnection({ cwd: profileLink.repo, env: { XDG_CONFIG_HOME: profileLink.config } }),
    (error) => error?.code === 'cli_config_invalid' && /profile must be a bounded regular non-symlink/u.test(error.message));

  const tokenLink = connectionFixture();
  symlinkSync(tokenLink.tokenFile, `${tokenLink.tokenFile}.link`);
  writeFileSync(tokenLink.profileFile, JSON.stringify({
    schemaVersion: 1, url: 'https://baton.test', origin: 'https://control.test', tokenFile: 'progressive.token.link',
  }), { mode: 0o600 });
  chmodSync(tokenLink.profileFile, 0o600);
  assert.throws(() => discoverBatonConnection({ cwd: tokenLink.repo, env: { XDG_CONFIG_HOME: tokenLink.config } }),
    (error) => error?.code === 'cli_config_invalid' && /token file must be a bounded regular non-symlink/u.test(error.message));

  if (typeof process.getuid === 'function') {
    const foreign = connectionFixture();
    assert.throws(() => discoverBatonConnection({
      cwd: foreign.repo, env: { XDG_CONFIG_HOME: foreign.config }, ownerUid: process.getuid() + 1,
    }), (error) => error?.code === 'cli_config_invalid' && /owned by the current user/u.test(error.message));
  }
});

test('contextual CLI help preserves semantic application.help while the package renders it locally', () => {
  assert.deepEqual(parseBatonCli(['--help']), { kind: 'help', topic: 'application' });
  assert.deepEqual(parseBatonCli(['run', 'show', '--help', '--idempotency-key', 'help-a']), {
    kind: 'command', name: 'application.help',
    args: { topic: 'run.inspect', depth: 'outline' }, idempotencyKey: 'help-a',
  });
  assert.equal(parseBatonCli(['run', 'do', '--help']).args.topic, 'run.act');
  assert.equal(parseBatonCli(['run', 'stop', '--help']).args.topic, 'run.stop');
});

test('Workflow CLI verbs resolve the current advertised action instead of exposing action IDs', async () => {
  const parsed = parseBatonCli([
    'run', 'revise', 'run-workflow', '--reason', 'Apply the accepted review.',
    '--idempotency-key', 'revision-a',
  ]);
  assert.deepEqual(parsed, {
    kind: 'semantic-action', actionKind: 'revise_candidate', runId: 'run-workflow',
    inputs: { reason: 'Apply the accepted review.' }, idempotencyKey: 'revision-a',
  });
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.inspect') return {
        outline: { actions: [{ kind: 'revise_candidate', actionId: 'action-server-bound' }] },
      };
      return { revised: true };
    },
  };
  assert.deepEqual(await runBatonCli(parsed, client), { revised: true });
  assert.deepEqual(calls, [
    {
      name: 'run.inspect', args: { runId: 'run-workflow', depth: 'outline' },
      key: 'revision-a:inspect',
    },
    {
      name: 'run.act',
      args: {
        runId: 'run-workflow', actionId: 'action-server-bound',
        inputs: { reason: 'Apply the accepted review.' },
      },
      key: 'revision-a:act',
    },
  ]);
});

test('local CLI help topics, default operations, actions, and selectors cannot drift from the semantic registry', () => {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const commandIds = new Set(registry.cli.commands.map((command) => command.id));
  assert.equal(commandIds.size, registry.cli.commands.length);
  for (const [topic, definition] of Object.entries(registry.cli.helpTopics)) {
    if (definition.aliasFor) {
      assert.ok(registry.cli.helpTopics[definition.aliasFor], `${topic} aliases an unknown topic`);
      assert.equal(batonCliHelp(topic), batonCliHelp(definition.aliasFor));
      continue;
    }
    const rendered = batonCliHelp(topic);
    for (const commandId of definition.commandIds ?? []) {
      assert.ok(commandIds.has(commandId), `${topic} references unknown command ${commandId}`);
      const command = registry.cli.commands.find((candidate) => candidate.id === commandId);
      assert.match(rendered, new RegExp(command.usage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
  }
  for (const operation of registry.defaultOperations) {
    const definition = registry.operations[operation];
    assert.ok(definition, `unknown default operation ${operation}`);
    assert.equal(batonCliHelp(definition.helpTopic).startsWith('No local help'), false, operation);
  }
  for (const [kind, action] of Object.entries(registry.actions)) {
    const command = action.genericCli === true
      ? registry.cli.commands.find((candidate) => candidate.id === 'run.do')
      : registry.cli.commands.find((candidate) => candidate.action === kind);
    assert.ok(command, `action ${kind} has no CLI projection`);
    assert.equal(command.operation === undefined || registry.defaultOperations.includes(command.operation), true);
    const rendered = batonCliHelp(action.helpTopic);
    assert.match(rendered, new RegExp(action.label, 'u'));
    const usage = action.genericCli === true ? command.usage.replace('ACTION_ID', kind) : command.usage;
    assert.match(rendered, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.deepEqual(registry.cli.selectorRules.manualRoute.requiredTogether, ['model', 'effort']);
  assert.deepEqual(registry.cli.selectorRules.exactRoute.axes, ['harness', 'model', 'effort']);
  assert.match(registry.cli.selectorRules.manualRoute.description, /harness is required when that pair matches multiple routes/u);
  assert.match(registry.cli.selectorRules.routingDetail.description, /multi-route profiles return typed ambiguity/u);
  assert.match(registry.cli.selectorRules.routingDetail.description, /fixed route is never a manual-selector tie-breaker/u);
  assert.match(batonCliHelp('run'), new RegExp(registry.cli.selectorRules.manualRoute.description, 'u'));
  assert.match(batonCliHelp('routing'), new RegExp(registry.cli.selectorRules.routingDetail.description, 'u'));
  assert.ok(registry.cli.commands.some((command) => command.action === 'export_result'
    && command.usage === 'baton run export RUN_ID DIR'));
});

test('bound Pythonic facade cascades start, inspect, semantic action, continuation, and stop', async () => {
  const calls = [];
  const principal = { actor: 'agent:test', principalId: 'agent', sessionId: 'session' };
  const approve = { kind: 'approve_plan', actionId: 'action-approve' };
  const application = {
    async command(name, args, caller) {
      calls.push({ name, args, caller });
      if (name === 'run.start') return { runId: 'run-bound', outline: { actions: [approve] } };
      if (name === 'run.inspect') return {
        runId: 'run-bound', outline: { actions: [approve] },
        continuation: { operation: 'run.inspect', arguments: { runId: 'run-bound', depth: 'outline', cursor: 4, waitMs: 100 } },
      };
      if (name === 'run.act') return { runId: 'run-bound', outline: { actions: [] }, action: 'approved' };
      if (name === 'run.answer') return { runId: 'run-bound', attention: [] };
      if (name === 'run.steer') return { runId: 'run-bound', steered: true };
      if (name === 'run.stop') return { runId: 'run-bound', terminal: true };
      throw new Error(`unexpected ${name}`);
    },
  };
  const baton = bindBaton(application, principal);
  const run = await baton.runs.start('Improve Baton', { model: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(run.id, 'run-bound');
  await run.inspect();
  await run.wait();
  await run.approve();
  await run.answer('request-one', { decision: 'allow' });
  await run.steer('worker-one', 'Continue with the focused implementation.');
  await run.stop();
  assert.deepEqual(calls.map(({ name }) => name), [
    'run.start', 'run.inspect', 'run.inspect', 'run.act', 'run.answer', 'run.steer', 'run.stop',
  ]);
  assert.deepEqual(calls[0].args, {
    intent: { objective: 'Improve Baton', route: { model: 'gpt-5.6-sol', effort: 'high' } },
  });
  assert.deepEqual(calls[3].args, {
    runId: 'run-bound', actionId: 'action-approve', inputs: {},
  });
  assert.deepEqual(calls[4].args, {
    runId: 'run-bound', requestId: 'request-one', answer: { decision: 'allow' },
  });
  assert.deepEqual(calls[5].args, {
    runId: 'run-bound', target: 'worker-one', mode: 'nudge',
    message: 'Continue with the focused implementation.',
    reason: 'Orchestrator steered the active worker.',
  });
  assert.ok(calls.every(({ caller }) => caller === principal));
});

test('bound Run changes emits the current outline once, suppresses replay, and ends at the server terminal', async () => {
  const calls = [];
  const pages = [
    {
      viewDigest: 'a'.repeat(64), changed: true, outline: { phase: 'caller-bytes-must-not-define-replay' },
      continuation: { operation: 'run.inspect', arguments: { runId: 'run-changes', cursor: 1, waitMs: 25 } },
    },
    {
      viewDigest: 'b'.repeat(64), changed: false, outline: { phase: 'caller-bytes-must-not-define-change' },
      continuation: { operation: 'run.inspect', arguments: { runId: 'run-changes', cursor: 2, waitMs: 25 } },
    },
    {
      viewDigest: 'b'.repeat(64), changed: true, outline: { phase: 'work_completed' },
      continuation: { operation: 'run.inspect', arguments: { runId: 'run-changes', cursor: 3, waitMs: 25 } },
    },
    { viewDigest: 'c'.repeat(64), changed: true, terminal: true, outline: { phase: 'completed' } },
  ];
  const application = {
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.start') return {
        runId: 'run-changes', viewDigest: 'a'.repeat(64), outline: { phase: 'running' },
        continuation: { operation: 'run.inspect', arguments: { runId: 'run-changes', cursor: 0, waitMs: 25 } },
      };
      return pages.shift();
    },
  };
  const run = await bindBaton(application, {}).runs.start('Observe exact changes');
  const observed = [];
  for await (const view of run.changes()) observed.push(view.outline.phase);
  assert.deepEqual(observed, ['running', 'work_completed', 'completed']);
  assert.deepEqual(calls.slice(1).map(({ args }) => args.cursor), [0, 1, 2, 3]);
  assert.equal(run.last.terminal, true);
});

test('bound Run changes fails closed when a server observation omits its bounded identity or changed flag', async () => {
  for (const malformed of [
    { changed: true, outline: { phase: 'running' } },
    { viewDigest: 'b'.repeat(64), outline: { phase: 'running' } },
  ]) {
    const application = {
      async command(name) {
        if (name === 'run.start') return {
          runId: 'run-malformed', viewDigest: 'a'.repeat(64), outline: { phase: 'running' },
          continuation: { operation: 'run.inspect', arguments: { runId: 'run-malformed', cursor: 0 } },
        };
        return malformed;
      },
    };
    const run = await bindBaton(application, {}).runs.start('Reject invented observation semantics');
    const changes = run.changes();
    assert.equal((await changes.next()).value.outline.phase, 'running');
    await assert.rejects(changes.next(), (error) => error?.code === 'application_client_invalid');
  }
});

test('recursive runner keeps following work_completed until result adoption is offered', () => {
  const source = readFileSync(new URL(
    '../../docs/reference/evidence/phase67-progressive-application-dogfood-2026-07-14/run.mjs',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /terminalWithoutAdoption = new Set\(\['completed', 'failed', 'cancelled', 'denied', 'stopped'\]\)/u);
  assert.match(source, /if \(adopt \|\| attention \|\| terminalWithoutAdoption\.has\(outline\.outline\.phase\)\) break;/u);
  assert.match(source, /run\.act\(attention\.actionId, \{ decision: 'allow' \}\)/u);
  assert.match(source, /progressive_question_attention_required/u);
  for (const leakedControl of [
    'BATON_DOGFOOD_TOKEN_BUDGET', 'BATON_DOGFOOD_USD_BUDGET',
    'BATON_DOGFOOD_WALL_MINUTES', 'BATON_DOGFOOD_PROVIDER_TURNS',
    'BATON_DOGFOOD_EXPORT_MAX_FILES', 'BATON_DOGFOOD_EXPORT_MAX_BYTES',
    'BATON_TARGET_REPO', 'BATON_EVIDENCE_DIR', 'BATON_EVIDENCE_OWNER_ROOT',
  ]) {
    assert.equal(source.includes(leakedControl), false,
      `${leakedControl} must not remain an ordinary evidence-runner control`);
  }
  assert.match(source,
    /usage: run\.mjs OBJECTIVE --model MODEL --effort EFFORT \[--harness HARNESS\]/u);
});

test('bound Run changes cancellation ends only observation and accepts no other option', async () => {
  let resolveObservation;
  const calls = [];
  const application = {
    async command(name) {
      calls.push(name);
      if (name === 'run.start') return {
        runId: 'run-cancel', viewDigest: 'a'.repeat(64), outline: { phase: 'running' },
        continuation: { operation: 'run.inspect', arguments: { runId: 'run-cancel', cursor: 0, waitMs: 25 } },
      };
      return new Promise((resolve) => { resolveObservation = resolve; });
    },
  };
  const run = await bindBaton(application, {}).runs.start('Cancel observation only');
  const controller = new AbortController();
  const changes = run.changes({ signal: controller.signal });
  assert.equal((await changes.next()).value.outline.phase, 'running');
  const waiting = changes.next();
  await Promise.resolve();
  controller.abort('observer left');
  assert.deepEqual(await waiting, { value: undefined, done: true });
  assert.deepEqual(calls, ['run.start', 'run.inspect']);
  assert.equal(calls.includes('run.stop'), false);
  resolveObservation({ terminal: true, viewDigest: 'b'.repeat(64), outline: { phase: 'completed' } });
  await Promise.resolve();
  assert.equal(run.last.viewDigest, 'a'.repeat(64),
    'an observation that resolves after abort must not overwrite the current Run view');

  await assert.rejects(run.changes({ waitMs: 1 }).next(),
    (error) => error?.code === 'application_client_invalid');
  await assert.rejects(run.changes({ signal: {} }).next(),
    (error) => error?.code === 'application_client_invalid');
});

test('bound Run drive abort fences a late continuation result', async () => {
  let resolveObservation;
  const application = {
    async command(name) {
      if (name === 'run.start') return {
        runId: 'run-drive-abort', viewDigest: 'c'.repeat(64), outline: {
          phase: 'running', actions: [], attention: { state: 'none' },
        },
        continuation: {
          operation: 'run.inspect',
          arguments: { runId: 'run-drive-abort', cursor: 0, waitMs: 25 },
        },
      };
      return new Promise((resolve) => { resolveObservation = resolve; });
    },
  };
  const run = await bindBaton(application, {}).runs.start('Fence an aborted drive');
  const controller = new AbortController();
  const driving = run.drive({ signal: controller.signal });
  await Promise.resolve();
  controller.abort('operator stopped waiting');
  assert.equal((await driving).viewDigest, 'c'.repeat(64));
  resolveObservation({
    terminal: true, viewDigest: 'd'.repeat(64),
    outline: { phase: 'completed', actions: [], attention: { state: 'none' } },
  });
  await Promise.resolve();
  assert.equal(run.last.viewDigest, 'c'.repeat(64),
    'a continuation that resolves after drive abort must not overwrite the Run view');
});

test('bound Context call complete follows unchanged timed-out observations until the call settles', async () => {
  const callId = `context-call:${'a'.repeat(64)}`;
  let continuationPolls = 0;
  const calls = [];
  const contextView = (state) => ({
    runId: 'run-context-complete',
    depth: 'item',
    viewDigest: (state === 'completed' ? 'b' : 'a').repeat(64),
    changed: state === 'completed',
    item: { id: callId, state },
    ...(state === 'completed' ? {} : {
      continuation: {
        operation: 'run.inspect',
        arguments: {
          runId: 'run-context-complete', depth: 'outline',
          cursor: continuationPolls, waitMs: 25,
        },
      },
    }),
  });
  const outlineView = (state, change = {}) => ({
    runId: 'run-context-complete', depth: 'outline',
    viewDigest: (state === 'completed' ? 'b' : 'a').repeat(64),
    changed: state === 'completed',
    outline: { phase: 'running', actions: [], attention: { state: 'none' } },
    ...(state === 'completed' ? {} : {
      continuation: {
        operation: 'run.inspect',
        arguments: {
          runId: 'run-context-complete', depth: 'outline',
          cursor: continuationPolls, waitMs: 25,
        },
      },
    }),
    ...change,
  });
  const application = {
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.start') return {
        runId: 'run-context-complete',
        viewDigest: '0'.repeat(64),
        outline: { phase: 'running', actions: [], attention: { state: 'none' } },
      };
      if (name !== 'run.inspect') throw new Error(`unexpected ${name}`);
      if (args.depth === 'item') {
        return contextView(continuationPolls >= 2 ? 'completed' : 'running');
      }
      if (args.cursor === undefined) {
        return outlineView(continuationPolls >= 2 ? 'completed' : 'running');
      }
      continuationPolls += 1;
      if (continuationPolls === 1) {
        return outlineView('running', { timedOut: true, changed: false });
      }
      return outlineView('completed');
    },
  };
  const run = await bindBaton(application, {}).runs.start('Wait for one slow Context call');
  const completed = await run.context().call(callId).complete();
  assert.equal(completed.item.state, 'completed');
  assert.equal(continuationPolls, 2,
    'an unchanged bounded observation must not make complete return a running call');
  assert.equal(calls.filter(({ args }) => args?.depth === 'outline'
    && args?.cursor !== undefined).length, 2);
  assert.equal(calls.filter(({ args }) => args?.depth === 'item')
    .every(({ args }) => args.section === 'context' && args.item === callId), true);
});

test('bound ordinary start rejects deployment policy and storage plumbing', async () => {
  const baton = bindBaton({ command: async () => ({ runId: 'unused' }) }, {});
  await assert.rejects(() => baton.runs.start('Invalid plumbing', { tokens: 10_000 }),
    (error) => error?.code === 'application_client_invalid');
  await assert.rejects(() => baton.runs.start('Invalid plumbing', { exportRoot: '/tmp/export' }),
    (error) => error?.code === 'application_client_invalid');
  await assert.rejects(() => baton.runs.start('No implicit effort', { model: 'gpt-5.6-sol' }),
    (error) => error?.code === 'application_client_invalid' && /model and effort together/u.test(error.message));
});
