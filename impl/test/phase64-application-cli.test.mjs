import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BatonWebClient, BatonWebHost, SignalLifecycleOwner, parseBatonCli,
  projectBatonCliResult, runBatonCli,
} from '../src/index.mjs';
import * as applicationCli from '../src/application-cli.mjs';

const D = 'a'.repeat(64);

test('UC1: concise CLI vocabulary compiles only shipped commands into shared Run arguments', () => {
  const start = parseBatonCli(['run', 'start', 'Ship it', '--profile', 'standard', '--exact', 'codex/gpt-5.6-sol@low', '--scope', 'impl/src,impl/test', '--run-id', 'run-a', '--idempotency-key', 'start-a']);
  assert.deepEqual(start, {
    kind: 'command', name: 'run.start', idempotencyKey: 'start-a',
    args: { intent: { objective: 'Ship it', resultIntent: 'change', profile: 'standard', route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' }, runId: 'run-a', scope: ['impl/src', 'impl/test'] } },
  });
  assert.equal(parseBatonCli(['run', 'status', 'run-a', '--wait', '5s']).name, 'run.wait');
  assert.deepEqual(parseBatonCli([
    'run', 'show', 'run-a', '--depth', 'item', '--section', 'plan', '--item', 'plan-node:work:v1',
    '--idempotency-key', 'show-a',
  ]), {
    kind: 'command', name: 'run.inspect', idempotencyKey: 'show-a',
    args: { runId: 'run-a', depth: 'item', section: 'plan', item: 'plan-node:work:v1' },
  });
  assert.throws(() => parseBatonCli(['run', 'show', 'run-a', '--depth', 'section']),
    /selectors do not match/u);
  assert.throws(() => parseBatonCli(['run', 'show', 'run-a', '--depth', 'index', '--section', 'plan']),
    /selectors do not match/u);
  assert.deepEqual(parseBatonCli(['run', 'status', 'run-a', '--follow', '--wait', '5s', '--idempotency-key', 'follow-a']), {
    kind: 'follow', runId: 'run-a', timeoutMs: 5_000, idempotencyKey: 'follow-a',
  });
  const events = parseBatonCli(['run', 'events', 'run-a', '--follow', '--idempotency-key', 'events-a']);
  assert.deepEqual(events, {
    kind: 'stream', runId: 'run-a', channel: 'events', follow: true,
    idempotencyKey: 'events-a',
  });
  const output = parseBatonCli(['run', 'output', 'run-a', '--to', 'review']);
  assert.deepEqual(output, {
    kind: 'stream', runId: 'run-a', channel: 'output', follow: false,
    recipient: 'review', idempotencyKey: output.idempotencyKey,
  });
  assert.equal(parseBatonCli(['run', 'progress', 'run-a']).channel, 'progress');
  assert.deepEqual(parseBatonCli(['run', 'approve', 'run-a', '--plan', D]).args, { runId: 'run-a', planDigest: D });
  assert.deepEqual(parseBatonCli(['run', 'answer', 'run-a', 'question-a', '--allow']).args.answer, { decision: 'allow' });
  assert.deepEqual(parseBatonCli(['run', 'answer', 'run-a', 'question-a', '--text', 'Proceed.']).args.answer, { text: 'Proceed.' });
  assert.deepEqual(parseBatonCli(['run', 'steer', 'run-a', 'w-1', '--now', 'Refocus.', '--reason', 'New evidence']).args,
    { runId: 'run-a', target: 'w-1', mode: 'now', message: 'Refocus.', reason: 'New evidence' });
  const send = parseBatonCli(['run', 'send', 'run-a', 'Refocus.', '--to', 'review', '--now']);
  assert.deepEqual(send, {
    kind: 'semantic-action', actionKind: 'send', runId: 'run-a',
    inputs: { message: 'Refocus.', recipient: 'review', delivery: 'now' },
    idempotencyKey: send.idempotencyKey,
  });
  const interrupt = parseBatonCli(['run', 'interrupt', 'run-a', '--to', 'work', '--reason', 'Review now']);
  assert.equal(interrupt.kind, 'semantic-action');
  assert.equal(interrupt.actionKind, 'interrupt');
  assert.deepEqual(interrupt.inputs, { recipient: 'work', reason: 'Review now' });
  assert.equal(parseBatonCli(['run', 'stop', 'run-a', '--reason', 'Cancelled']).name, 'run.stop');
  assert.equal(parseBatonCli(['run', 'evidence', 'run-a']).name, 'run.evidence');
  assert.equal(parseBatonCli(['run', 'adopt', 'run-a', '--reason', 'Select result']).kind, 'adopt');
  assert.deepEqual(parseBatonCli(['run', 'review', 'run-a', '--exact', 'grok/grok-4.5@low', '--reason', 'Independent review']).args, {
    runId: 'run-a', route: { harness: 'grok', model: 'grok-4.5', effort: 'low' }, reason: 'Independent review',
  });
  assert.equal(parseBatonCli(['run', 'integrate', 'run-a', '--strategy', 'ff-only', '--reason', 'Reviewed']).kind, 'integrate');
  assert.deepEqual(parseBatonCli(['serve', './deployment.mjs']), { kind: 'serve', configPath: './deployment.mjs' });
  assert.deepEqual(parseBatonCli(['run', 'recover', 'run-a', '--idempotency-key', 'recover-a']), {
    kind: 'command', name: 'run.recover', args: { runId: 'run-a' }, idempotencyKey: 'recover-a',
  });
  assert.throws(() => parseBatonCli(['run', 'follow', 'run-a']), (error) => error.code === 'cli_command_unavailable');
  assert.throws(() => parseBatonCli(['run', 'start', 'x', '--profile', 'p', '--exact', 'gpt-5.6-sol']), /HARNESS\/MODEL@EFFORT/);
});

test('UC1b: ordinary CLI mutations project a true outline and hide internal authority chapters', () => {
  const parsed = parseBatonCli(['run', 'send', 'run-a', 'Refocus.', '--nudge']);
  const full = {
    schemaVersion: 1, runId: 'run-a', objective: 'Ship it', phase: 'running',
    progress: { current: 'provider', summary: 'Provider turn active', stages: [{ key: 'provider' }] },
    narrative: '1 worker(s) active.',
    nextActions: [{ kind: 'wait' }, { kind: 'stop' }],
    route: {
      requested: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' },
      resolved: { harness: 'codex@1', model: 'gpt-5.6-sol', effort: 'low' },
      observed: { harness: null, model: 'gpt-5.6-sol', effort: null },
      launchEnforcement: { model: { state: 'matched' } },
    },
    budget: { allocated: { tokens: 100_000_000, usd: 1_000 } },
    nodes: [{ taskId: 'private-task' }],
    workerPolicy: { state: 'observed' },
    ownership: { workers: 1, workerIds: ['w-17'], closed: false },
    lastAction: {
      command: 'run.send', recipient: 'work', delivery: 'nudge', result: 'ok',
      state: 'confirmed', emulated: true, deliveredDespiteStale: false,
      onlyActiveMember: true, needsAttention: false,
    },
    attention: [],
  };
  const outline = projectBatonCliResult(parsed, full);
  assert.deepEqual(outline.progress, { current: 'provider', summary: 'Provider turn active' });
  assert.deepEqual(outline.resources, { ownedWorkers: 1, reaped: false });
  assert.equal(outline.inspect.command, 'baton run show run-a');
  assert.equal(outline.lastAction.command, 'run.send');
  const encoded = JSON.stringify(outline);
  for (const internal of ['budget', 'workerIds', 'private-task', 'launchEnforcement', 'workerPolicy', 'stages']) {
    assert.equal(encoded.includes(internal), false, `ordinary CLI output leaked ${internal}`);
  }
  const shown = projectBatonCliResult(parseBatonCli(['run', 'show', 'run-a']), {
    runId: 'run-a', depth: 'outline', terminal: false,
    outline: {
      objective: 'Ship it', phase: 'running', stage: 'provider', narrative: 'Working.',
      progress: { current: 'provider', summary: 'Provider active', stages: [{ key: 'provider' }] },
      route: full.route,
      workerPolicy: full.workerPolicy,
      actions: [{
        actionId: 'action-a', kind: 'send', label: 'Send guidance', summary: 'Guide work.',
        destructive: false, choices: ['work'], inputSchema: { type: 'object' },
        help: { topic: 'run.act.send' },
      }],
    },
  });
  assert.equal(shown.depth, 'outline');
  assert.deepEqual(shown.outline.progress, { current: 'provider', summary: 'Provider active' });
  assert.deepEqual(shown.outline.actions[0], {
    actionId: 'action-a', kind: 'send', label: 'Send guidance', summary: 'Guide work.',
    destructive: false, choices: ['work'], help: 'baton help run.act.send',
  });
  assert.equal(JSON.stringify(shown).includes('inputSchema'), false);
  assert.equal(JSON.stringify(shown).includes('workerPolicy'), false);

  const indexed = projectBatonCliResult(parseBatonCli([
    'run', 'show', 'run-a', '--depth', 'index',
  ]), {
    runId: 'run-a', depth: 'index', terminal: false, registryDigest: D, cursor: 42,
    sections: [{
      id: 'execution', state: 'running', itemCount: 1, truncated: false,
      summary: 'Current execution.', expand: { depth: 'section', section: 'execution' },
    }],
  });
  assert.deepEqual(indexed.sections[0], {
    id: 'execution', state: 'running', items: 1, summary: 'Current execution.',
    inspect: 'baton run show run-a --depth section --section execution',
  });
  assert.equal(JSON.stringify(indexed).includes('registryDigest'), false);
  assert.equal(JSON.stringify(indexed).includes('cursor'), false);

  const section = projectBatonCliResult(parseBatonCli([
    'run', 'show', 'run-a', '--depth', 'section', '--section', 'execution',
  ]), {
    runId: 'run-a', depth: 'section', terminal: false,
    section: {
      id: 'execution', state: 'running', summary: 'Current execution.', truncated: false,
      items: [{ id: 'execution:summary:c42', state: 'running', summary: 'Execution state.', value: { taskId: 'private-task' } }],
    },
  });
  assert.equal(section.section.items[0].inspect,
    'baton run show run-a --depth item --section execution --item execution:summary:c42');
  assert.equal(JSON.stringify(section).includes('private-task'), false);
});

test('UC2: authenticated CLI client sends the same strict Web envelope and reconciles admitted commands', async () => {
  const requests = [];
  let now = 0;
  const responses = [
    { ok: true, body: { ok: true, status: 'admitted' } },
    { ok: true, body: { ok: true, command: { status: 'admitted' } } },
    { ok: true, body: { ok: true, command: { status: 'completed', outcome: { httpStatus: 200, body: { ok: true, result: { runId: 'run-a', phase: 'running' } } } } } },
  ];
  const client = new BatonWebClient({
    baseUrl: 'https://baton.test', origin: 'https://control.test', repoId: 'repo-a', token: 'private-bearer',
    commandTimeoutMs: 1_000, pollMs: 10,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { ok: response.ok, async json() { return response.body; } };
    },
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  const result = await client.command('run.status', { runId: 'run-a' }, 'status-a');
  assert.deepEqual(result, { runId: 'run-a', phase: 'running' });
  const envelope = JSON.parse(requests[0].options.body);
  assert.equal(envelope.command, 'run_status');
  assert.equal(envelope.idempotencyKey, 'status-a');
  assert.equal(envelope.repoId, 'repo-a');
  assert.equal(envelope.origin, 'https://control.test');
  assert.deepEqual(envelope.args, { runId: 'run-a' });
  assert.equal(requests[0].options.headers.authorization, 'Bearer private-bearer');
  assert.equal(requests[0].options.body.includes('private-bearer'), false);
  assert.equal(requests[1].url.endsWith(`/v1/commands/${envelope.commandId}`), true);
});

test('UC2b: Web client gives server-owned Run waits transport slack instead of racing them', () => {
  const client = new BatonWebClient({
    baseUrl: 'https://baton.test', origin: 'https://control.test', repoId: 'repo-a', token: 'private-bearer',
    commandTimeoutMs: 90_000, pollMs: 100,
    fetchImpl: async () => { throw new Error('not invoked'); },
    clock: Date.now, sleep: async () => {},
  });
  assert.equal(client._requestTimeoutForCommand('run.status', { runId: 'run-a' }), 45_000);
  assert.equal(client._requestTimeoutForCommand('run.wait', {
    runId: 'run-a', timeoutMs: 30_000,
  }), 45_000);
  assert.equal(client._requestTimeoutForCommand('run.inspect', {
    runId: 'run-a', cursor: 4,
  }), 45_000);
  assert.equal(client._requestTimeoutForCommand('run.inspect', {
    runId: 'run-a', cursor: 4, waitMs: 60_000,
  }), 75_000);
});

test('UC3: adopt reads terminal evidence then binds its displayed digest without caller-side Git inspection', async () => {
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.evidence') return { runId: 'run-a', manifestDigest: D, result: { nodeKey: 'work', sha: 'b'.repeat(40) } };
      return { runId: 'run-a', phase: 'work_completed', result: { state: 'adopted' } };
    },
  };
  const parsed = parseBatonCli(['run', 'adopt', 'run-a', '--reason', 'Independent result selected', '--idempotency-key', 'adopt-a']);
  const result = await runBatonCli(parsed, client);
  assert.equal(result.result.state, 'adopted');
  assert.deepEqual(calls, [
    { name: 'run.evidence', args: { runId: 'run-a' }, key: 'adopt-a:evidence' },
    { name: 'run.adopt', args: { runId: 'run-a', nodeKey: 'work', resultSha: 'b'.repeat(40), evidenceDigest: D, reason: 'Independent result selected' }, key: 'adopt-a:adopt' },
  ]);
});

test('UC3b: integrate reads fresh terminal evidence and binds its displayed digest', async () => {
  const calls = [];
  const client = { command: async (name, args, key) => {
    calls.push({ name, args, key });
    if (name === 'run.evidence') return { manifestDigest: D };
    return { runId: 'run-a', phase: 'completed', integration: { state: 'integrated' } };
  } };
  const parsed = parseBatonCli(['run', 'integrate', 'run-a', '--strategy', 'ff-only', '--reason', 'Reviewed result', '--idempotency-key', 'integrate-a']);
  const result = await runBatonCli(parsed, client);
  assert.equal(result.phase, 'completed');
  assert.deepEqual(calls, [
    { name: 'run.evidence', args: { runId: 'run-a' }, key: 'integrate-a:evidence' },
    { name: 'run.integrate', args: { runId: 'run-a', evidenceDigest: D, strategy: 'ff-only', reason: 'Reviewed result' }, key: 'integrate-a:integrate' },
  ]);
});

test('UC3c: follow derives its wait from the admitted profile and streams bounded cursor pages until attention is required', async () => {
  const calls = [];
  const pages = [];
  const responses = [
    { runId: 'run-a', phase: 'running', cursor: 12, profile: { name: 'standard', digest: D }, follow: { afterCursor: 10, throughCursor: 12, changes: [{ cursor: 12, category: 'execution', kind: 'task.started' }], timedOut: false, terminal: false } },
    { runId: 'run-a', phase: 'work_completed', cursor: 15, profile: { name: 'standard', digest: D }, follow: { afterCursor: 12, throughCursor: 15, changes: [{ cursor: 15, category: 'result', kind: 'task.completed' }], timedOut: false, terminal: true } },
  ];
  const client = {
    async doctor() {
      calls.push({ name: 'doctor' });
      return { application: { profiles: [{ name: 'standard', digest: D, followPolicy: { mode: 'enabled', maxWaitMs: 25_000, maxChanges: 64, maxResponseBytes: 262_144, maxScanEvents: 1_024 } }] } };
    },
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.status') return { runId: 'run-a', phase: 'running', cursor: 10, profile: { name: 'standard', digest: D } };
      return responses.shift();
    },
  };
  const result = await runBatonCli(parseBatonCli(['run', 'status', 'run-a', '--follow', '--idempotency-key', 'follow-a']), client, {
    onFollowPage: async (page) => pages.push(page),
  });
  assert.equal(result.phase, 'work_completed');
  assert.deepEqual(pages.map((page) => [page.follow.afterCursor, page.follow.throughCursor]), [[10, 12], [12, 15]]);
  assert.deepEqual(calls, [
    { name: 'run.status', args: { runId: 'run-a' }, key: 'follow-a:status' },
    { name: 'doctor' },
    { name: 'run.follow', args: { runId: 'run-a', afterCursor: 10, timeoutMs: 25_000 }, key: 'follow-a:follow:0:10' },
    { name: 'run.follow', args: { runId: 'run-a', afterCursor: 12, timeoutMs: 25_000 }, key: 'follow-a:follow:1:12' },
  ]);
});

test('UC3d/RT5: Run event follow consumes server-owned timeline cursors without exposing them as CLI arguments', async () => {
  const calls = [];
  const pages = [];
  const responses = [
    {
      runId: 'run-a', depth: 'content', cursor: 10, terminal: false,
      content: { kind: 'baton.run_timeline.page', runId: 'run-a', channel: 'events', cursor: 'page-a', hasMore: true, items: [{ runId: 'run-a', position: 1 }] },
    },
    {
      runId: 'run-a', depth: 'content', cursor: 10, terminal: false,
      content: { kind: 'baton.run_timeline.page', runId: 'run-a', channel: 'events', cursor: 'page-b', hasMore: false, items: [{ runId: 'run-a', position: 2 }] },
    },
    {
      runId: 'run-a', depth: 'content', cursor: 14, terminal: true,
      content: { kind: 'baton.run_timeline.page', runId: 'run-a', channel: 'events', cursor: 'page-c', hasMore: false, items: [{ runId: 'run-a', position: 3 }] },
    },
  ];
  const client = { command: async (name, args, key) => {
    calls.push({ name, args, key });
    return responses.shift();
  } };
  const parsed = parseBatonCli([
    'run', 'events', 'run-a', '--follow', '--idempotency-key', 'events-a',
  ]);
  const result = await runBatonCli(parsed, client, {
    onFollowPage: async (page) => pages.push(page),
  });
  assert.equal(result.terminal, true);
  assert.deepEqual(pages.flatMap((page) => page.content.items.map((item) => item.position)), [1, 2, 3]);
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: 'run.inspect', args: { runId: 'run-a', depth: 'content', section: 'execution', item: 'execution:events' } },
    { name: 'run.inspect', args: { runId: 'run-a', depth: 'content', section: 'execution', item: 'execution:events', pageCursor: 'page-a' } },
    { name: 'run.inspect', args: { runId: 'run-a', depth: 'content', section: 'execution', item: 'execution:events', pageCursor: 'page-b', cursor: 10 } },
  ]);
  assert.equal(parsed.pageCursor, undefined);
  assert.equal(parsed.cursor, undefined);
  const projected = projectBatonCliResult(parsed, pages[0]);
  assert.equal(Object.hasOwn(projected, 'cursor'), false);
  assert.equal(JSON.stringify(projected).includes('page-a'), false);

  await assert.rejects(runBatonCli(
    parseBatonCli(['run', 'events', 'run-a']),
    { command: async () => ({
      runId: 'run-sibling', content: {
        kind: 'baton.run_timeline.page', runId: 'run-sibling', channel: 'events',
        cursor: 'crossed', hasMore: false, items: [],
      },
    }) },
  ), (error) => error.code === 'cli_protocol_failed');
});

test('UC4: packaged baton entry has pure help output and never requires credentials for help', (t) => {
  const output = execFileSync(process.execPath, ['scripts/baton.mjs', '--help'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {} });
  assert.match(output, /^usage:/);
  assert.match(output, /BATON_TOKEN/);
  assert.match(output, /baton setup(?:\s|$)/u);
  assert.match(output, /baton doctor .*--depth/u);
  assert.match(output, /--check/u);
  assert.equal(output.includes('--follow'), false);
  const runHelp = execFileSync(process.execPath, ['scripts/baton.mjs', 'help', 'run'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {},
  });
  assert.match(runHelp, /--follow/u);
  assert.match(runHelp, /manual routing always requires --model and --effort together/iu);
  const secret = 'distinctive-secret-that-must-not-leak';
  const contextual = spawnSync(process.execPath, ['scripts/baton.mjs', 'run', 'show', '--help'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { BATON_URL: 'https://baton.test', BATON_ORIGIN: 'https://control.test', BATON_REPO_ID: 'repo-a', BATON_TOKEN: secret },
  });
  assert.equal(contextual.status, 0);
  assert.match(contextual.stdout, /baton run show RUN_ID/u);
  assert.equal(`${contextual.stdout}${contextual.stderr}`.includes(secret), false);
  const isolatedRepo = mkdtempSync(join(tmpdir(), 'baton-cli-doctor-'));
  t.after(() => rmSync(isolatedRepo, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: isolatedRepo });
  const batonScript = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
  const diagnosed = spawnSync(process.execPath, [batonScript, 'doctor'], { cwd: isolatedRepo, encoding: 'utf8', env: {} });
  assert.equal(diagnosed.status, 0);
  assert.equal(diagnosed.stderr, '');
  const diagnosis = JSON.parse(diagnosed.stdout);
  assert.equal(diagnosis.state, 'needs_setup');
  assert.equal(diagnosis.outline.repository, 'ready');
  assert.equal(diagnosis.outline.connection, 'missing');
  assert.equal(JSON.stringify(diagnosis).includes('BATON_TOKEN'), false);
  const checked = spawnSync(process.execPath, [batonScript, 'doctor', '--check'], { cwd: isolatedRepo, encoding: 'utf8', env: {} });
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).state, 'needs_setup');
});

function setupFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-cli-setup-'));
  const repositoryRoot = join(root, 'repo');
  const configRoot = join(root, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  mkdirSync(join(repositoryRoot, '.git'), { recursive: true });
  mkdirSync(profilesRoot, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root, repositoryRoot, configRoot, profilesRoot,
    selectorPath: join(repositoryRoot, '.git', 'baton', 'connection.json'),
    options: { cwd: repositoryRoot, env: { XDG_CONFIG_HOME: configRoot }, home: root },
  };
}

function writeSetupProfile(fixture, name, token) {
  const tokenPath = join(fixture.profilesRoot, `${name}.token`);
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  writeFileSync(join(fixture.profilesRoot, `${name}.json`), JSON.stringify({
    schemaVersion: 1,
    url: `https://${name}.baton.test`,
    origin: 'https://control.baton.test',
    tokenFile: `${name}.token`,
  }), { mode: 0o600 });
}

test('UC4b: setup with no connection profiles is typed, non-mutating, and points to the missing user input', async (t) => {
  assert.equal(typeof applicationCli.setupBatonConnection, 'function');
  const fixture = setupFixture(t);
  const result = await applicationCli.setupBatonConnection({
    ...fixture.options,
    fetchImpl: async () => { throw new Error('setup must not contact a remote without a selected profile'); },
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.state, 'needs_user_input');
  assert.equal(existsSync(fixture.selectorPath), false);
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.deepEqual(parseBatonCli(['setup']), { kind: 'setup', profile: null });
});

test('UC4c: setup refuses ambiguous profiles until the caller selects one explicitly', async (t) => {
  const fixture = setupFixture(t);
  writeSetupProfile(fixture, 'alpha', 'alpha-private-token');
  writeSetupProfile(fixture, 'beta', 'beta-private-token');
  const result = await applicationCli.setupBatonConnection({
    ...fixture.options,
    fetchImpl: async () => { throw new Error('ambiguous setup must not contact a remote'); },
  });
  assert.equal(result.state, 'needs_user_input');
  assert.deepEqual(result.profiles, ['alpha', 'beta']);
  assert.equal(result.next.some(({ command }) => command.includes('baton setup --profile')), true);
  assert.equal(existsSync(fixture.selectorPath), false);
  assert.deepEqual(parseBatonCli(['setup', '--profile', 'beta']), { kind: 'setup', profile: 'beta' });
});

test('UC4d: selected setup authenticates both remote authorities before atomically publishing an owner-only selector', async (t) => {
  const fixture = setupFixture(t);
  const token = 'distinctive-setup-secret';
  writeSetupProfile(fixture, 'alpha', token);
  const requests = [];
  const responses = new Map([
    ['/v1/application-card', { ok: true, application: { schemaVersion: 1, repoId: 'repo-a' } }],
    ['/v1/session', { ok: true, identity: { userId: 'operator', capabilities: ['observe'], repoIds: ['repo-a'] }, expiresAt: '2026-07-18T00:00:00.000Z' }],
  ]);
  const result = await applicationCli.setupBatonConnection({
    ...fixture.options,
    profile: 'alpha',
    fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname;
      requests.push({ pathname, options });
      const body = responses.get(pathname);
      assert.ok(body, `unexpected setup request ${pathname}`);
      return { ok: true, async json() { return body; } };
    },
  });
  assert.equal(result.state, 'configured');
  assert.deepEqual(requests.map(({ pathname }) => pathname), ['/v1/application-card', '/v1/session']);
  for (const request of requests) {
    assert.equal(request.options.headers.authorization, `Bearer ${token}`);
    assert.equal(JSON.stringify({ pathname: request.pathname, body: request.options.body ?? null }).includes(token), false);
  }
  const selectorSource = readFileSync(fixture.selectorPath, 'utf8');
  assert.deepEqual(JSON.parse(selectorSource), { schemaVersion: 1, profile: 'alpha', repoId: 'repo-a' });
  assert.equal(statSync(fixture.selectorPath).mode & 0o077, 0);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(selectorSource.includes(token), false);
});

test('UC5: deployment-owning Web host closes admission then exact application authority on signals', async () => {
  class Server extends EventEmitter {
    listen(port, host) { this.bound = { port, host }; queueMicrotask(() => this.emit('listening')); }
    address() { return { address: this.bound.host, port: 9443, family: 'IPv4' }; }
    async batonShutdown(options) { this.webStops = (this.webStops ?? 0) + 1; this.webOptions = options; return { ok: true, result: 'closed' }; }
  }
  const calls = [];
  const application = {
    ready: Promise.resolve(),
    async shutdown(value) { calls.push(value); return { schemaVersion: 1, state: 'closed', receipt: { receiptDigest: D } }; },
  };
  const server = new Server();
  const host = new BatonWebHost({
    application, server, shutdownPrincipal: { actor: 'host:test', principalId: 'host', sessionId: 'host-session' },
    listen: { host: '127.0.0.1', port: 0 }, webDrainMs: 5_000,
  });
  const signals = new EventEmitter();
  const serving = host.serve(signals);
  const listening = await host.start();
  assert.equal(listening.state, 'listening');
  signals.emit('SIGTERM');
  const outcome = await serving;
  assert.equal(outcome.trigger.kind, 'SIGTERM');
  assert.equal(outcome.closed.state, 'closed');
  assert.equal(server.webStops, 1);
  assert.deepEqual(server.webOptions, { drainMs: 5_000 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await host.shutdown(), outcome.closed);
  assert.equal(server.webStops, 1);
  assert.equal(calls.length, 1);
});

test('UC5b: repeated process signals remain admitted until abort-aware work and authoritative shutdown both settle', async () => {
  const signals = new EventEmitter();
  let releaseShutdown;
  let shutdownStarted;
  const shutdownGate = new Promise((resolve) => { releaseShutdown = resolve; });
  const started = new Promise((resolve) => { shutdownStarted = resolve; });
  const owner = new SignalLifecycleOwner({
    signalEmitter: signals,
    shutdown: async () => {
      shutdownStarted();
      await shutdownGate;
      return { schemaVersion: 1, state: 'closed' };
    },
  });
  const running = owner.run(async ({ signal }) => {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'interrupted' };
  });
  signals.emit('SIGHUP');
  await started;
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  signals.emit('SIGHUP');
  signals.emit('SIGINT');
  signals.emit('SIGTERM');
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  releaseShutdown();
  const outcome = await running;
  assert.equal(outcome.trigger.kind, 'SIGHUP');
  assert.equal(outcome.signalCount, 4);
  assert.equal(outcome.operation.status, 'fulfilled');
  assert.equal(outcome.closed.state, 'closed');
  assert.equal(signals.listenerCount('SIGHUP'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('UC6: host still attempts fleet shutdown when Web close degrades and never reports a clean close', async () => {
  class Server extends EventEmitter {
    listen() { queueMicrotask(() => this.emit('listening')); }
    address() { return null; }
    async batonShutdown() { throw Object.assign(new Error('listener close failed'), { code: 'listener_failed' }); }
  }
  let appStops = 0;
  const host = new BatonWebHost({
    application: { ready: Promise.resolve(), async shutdown() { appStops += 1; return { state: 'closed' }; } },
    server: new Server(), shutdownPrincipal: { actor: 'host:test', principalId: 'host', sessionId: 'host-session' },
    listen: { host: '127.0.0.1', port: 0 }, webDrainMs: 5_000,
  });
  await host.start();
  const closed = await host.shutdown();
  assert.equal(closed.state, 'closed_degraded');
  assert.equal(closed.web.code, 'listener_failed');
  assert.equal(appStops, 1);
});
