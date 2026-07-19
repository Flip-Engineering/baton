import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KimiSessionCli, loadProviderCredentialFile } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const MODEL = 'kimi-k3[1m]';
const brief = (goal) => ({ goal, constraints: [], pathScope: ['src/**'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } });

function collector(cli) {
  const events = [];
  cli.onEvent((event) => events.push(event));
  return async (worker) => {
    const limit = Date.now() + 4000;
    while (Date.now() < limit) {
      const found = events.find((event) => event.worker === worker && event.kind === 'lifecycle.turn_completed');
      if (found) return found.payload.result.summary;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('turn timeout');
  };
}

async function until(read, label, timeoutMs = 4000) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('KK1: card exposes exact K3 model and max-only required effort with no xhigh alias', () => {
  const card = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' }).card();
  assert.equal(card.harness, 'claude-code');
  assert.equal(card.modelSelection.family, 'kimi');
  assert.deepEqual(card.modelSelection.available, [MODEL]);
  assert.deepEqual(card.modelSelection.reasoningEffort, ['max']);
  assert.equal(card.modelSelection.effortRequired, true);
  assert.deepEqual(card.modelSelection.acceptedAliases, []);
  assert.equal(card.providerCompatibility.credentialState, 'available');
  assert.equal(card.permissions.mode, 'bypassPermissions', 'Kimi-through-Claude inherits the unattended Claude-family default');
  assert.throws(
    () => new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only', harness: 'kimi' }),
    (error) => error?.code === 'harness_identity_immutable',
  );
});

test('KK2/KK3: missing credential, missing effort, unsupported effort, and wrong model refuse before spawn without secrets', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-kimi-refuse-'));
  const cases = [
    [new KimiSessionCli({ cmd: process.execPath, args: [FAKE] }), { model: MODEL, reasoningEffort: 'max' }, 'credential_missing'],
    [new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' }), { model: MODEL }, 'effort_required'],
    [new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' }), { model: MODEL, reasoningEffort: 'xhigh' }, 'effort_unsupported'],
    [new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' }), { model: 'kimi-other', reasoningEffort: 'max' }, 'model_unsupported'],
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const [cli, route, code] = cases[i];
    const result = await cli.spawn(`r-${i}`, brief('never runs'), { worktree: wt, ...route });
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes('fixture-only'), false);
    assert.equal(cli._sessions.size, 0);
  }
});

test('KK2: each dispatch reaches the fake child with exact argv and closed official environment', async () => {
  const cli = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' });
  const wait = collector(cli);
  const wt = mkdtempSync(join(tmpdir(), 'baton-kimi-route-'));
  const official = {
    ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic', ANTHROPIC_AUTH_TOKEN: 'fixture-only',
    ANTHROPIC_MODEL: MODEL, ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL, ANTHROPIC_DEFAULT_FABLE_MODEL: MODEL, CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
    ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1048576', CLAUDE_CODE_EFFORT_LEVEL: 'max',
  };
  try {
    let n = 0;
    for (const [name, value] of Object.entries(official)) {
      if (name === 'ANTHROPIC_AUTH_TOKEN') continue;
      const worker = `k-${n++}`;
      const ack = await cli.spawn(worker, brief(`REPORT_ENV:${name}`), {
        worktree: wt, model: MODEL, reasoningEffort: 'max',
        env: {
          ANTHROPIC_API_KEY: 'ambient-must-disappear', MOONSHOT_API_KEY: 'ambient-must-disappear',
          CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1', AWS_PROFILE: 'ambient',
          CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1', CLOUD_ML_REGION: 'ambient',
          CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '1', FOUNDRY_RESOURCE: 'ambient',
          [name]: 'conflict',
        },
      });
      assert.equal(ack.ok, true, ack.reason);
      assert.ok((await wait(worker)).includes(`env:${name}=${value}`));
      await cli.kill(worker);
    }
    const authWorker = 'k-auth-presence';
    assert.equal((await cli.spawn(authWorker, brief('REPORT_ENV_PRESENT:ANTHROPIC_AUTH_TOKEN'), {
      worktree: wt, model: MODEL, reasoningEffort: 'max',
    })).ok, true);
    assert.ok((await wait(authWorker)).includes('env-present:ANTHROPIC_AUTH_TOKEN=true'));
    await cli.kill(authWorker);
    for (const name of [
      'ANTHROPIC_API_KEY', 'MOONSHOT_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'AWS_PROFILE',
      'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'CLOUD_ML_REGION',
      'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'FOUNDRY_RESOURCE',
    ]) {
      const worker = `k-strip-${name}`;
      const ack = await cli.spawn(worker, brief(`REPORT_ENV:${name}`), {
        worktree: wt, model: MODEL, reasoningEffort: 'max', env: { [name]: 'ambient-must-disappear' },
      });
      assert.equal(ack.ok, true, ack.reason);
      assert.ok((await wait(worker)).includes(`env:${name}=<unset>`));
      await cli.kill(worker);
    }
    const argvWorker = 'k-argv';
    assert.equal((await cli.spawn(argvWorker, brief('REPORT_ARGV'), { worktree: wt, model: MODEL, reasoningEffort: 'max' })).ok, true);
    const summary = await wait(argvWorker);
    assert.ok(summary.includes(`--model","${MODEL}`));
    assert.ok(summary.includes('--effort","max'));
    assert.ok(summary.includes('--permission-mode","bypassPermissions'));
  } finally {
    for (const worker of [...cli._sessions.keys()]) await Promise.resolve(cli.kill(worker)).catch(() => {});
  }
});

test('KK6: package entry point exports KimiSessionCli', async () => {
  assert.equal((await import('../src/index.mjs')).KimiSessionCli, KimiSessionCli);
});

test('KK3/KK8: credential file boundary is bounded, owner-only, symlink-safe, pointer-safe, and secret-free', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-kimi-credential-'));
  const credential = join(dir, 'credential.json');
  writeFileSync(credential, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'fixture-only' } }), { mode: 0o600 });
  assert.equal(loadProviderCredentialFile(credential, { providerLabel: 'Kimi' }), 'fixture-only');

  const expectCode = (path, code, options = {}) => assert.throws(
    () => loadProviderCredentialFile(path, { providerLabel: 'Kimi', ...options }),
    (error) => error?.code === code && error.message === `Kimi: ${code}` && !error.message.includes(path) && !error.message.includes('fixture-only'),
  );
  chmodSync(credential, 0o644);
  expectCode(credential, 'credential_file_permissions');
  chmodSync(credential, 0o600);
  expectCode(credential, 'credential_file_owner', { ownerUid: (typeof process.getuid === 'function' ? process.getuid() : 0) + 1 });

  const symlink = join(dir, 'credential-link');
  symlinkSync(credential, symlink);
  expectCode(symlink, 'credential_file_symlink');
  const oversized = join(dir, 'oversized');
  writeFileSync(oversized, 'x'.repeat((16 * 1024) + 1), { mode: 0o600 });
  expectCode(oversized, 'credential_file_size');
  const malformed = join(dir, 'malformed');
  writeFileSync(malformed, '{bad', { mode: 0o600 });
  expectCode(malformed, 'credential_json_malformed');
  expectCode(credential, 'credential_pointer_invalid', { jsonPointer: '/env/~2secret' });
  expectCode(credential, 'credential_pointer_missing', { jsonPointer: '/env/other' });

  const repository = join(dir, 'repository');
  mkdirSync(repository);
  const inRepository = join(repository, 'credential.json');
  writeFileSync(inRepository, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'fixture-only' } }), { mode: 0o600 });
  expectCode(inRepository, 'credential_path_forbidden', { forbiddenRoots: [repository] });
  assert.throws(
    () => new KimiSessionCli({ authTokenFile: inRepository, repoRoot: repository }),
    (error) => error?.code === 'credential_path_forbidden' && !error.message.includes(inRepository),
  );

  const originalFstat = fs.fstatSync;
  let fstatCalls = 0;
  fs.fstatSync = (...args) => {
    const stat = originalFstat(...args);
    fstatCalls += 1;
    return fstatCalls === 2 ? new Proxy(stat, {
      get(target, property) { return property === 'mtimeMs' ? target.mtimeMs + 1 : Reflect.get(target, property, target); },
    }) : stat;
  };
  syncBuiltinESMExports();
  try { expectCode(credential, 'credential_file_changed'); }
  finally {
    fs.fstatSync = originalFstat;
    syncBuiltinESMExports();
  }
});

test('KK5/KK8: model mismatch is a typed crash before ready and auth refusal remains failed', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-kimi-failure-'));
  const mismatch = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' });
  const mismatchEvents = [];
  mismatch.onEvent((event) => mismatchEvents.push(event));
  assert.equal((await mismatch.spawn('mismatch', brief('never runs'), {
    worktree: wt, model: MODEL, reasoningEffort: 'max', env: { FAKE_CLAUDE_REPORTED_MODEL: 'claude-fallback' },
  })).ok, true);
  const limit = Date.now() + 4000;
  while (!mismatchEvents.some((event) => event.kind === 'lifecycle.crashed') && Date.now() < limit) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const crashed = mismatchEvents.find((event) => event.kind === 'lifecycle.crashed');
  assert.equal(crashed?.payload?.code, 'model_mismatch');
  assert.equal(mismatchEvents.some((event) => event.kind === 'lifecycle.process_started'), true);
  assert.equal(mismatchEvents.some((event) => event.kind === 'lifecycle.spawned'), false);
  assert.equal(mismatchEvents.some((event) => event.kind === 'lifecycle.turn_started'), false, 'Brief crossed the wire before model readiness');
  assert.equal(mismatchEvents.some((event) => event.kind === 'lifecycle.process_closed'), true);

  const auth = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' });
  const events = [];
  auth.onEvent((event) => events.push(event));
  assert.equal((await auth.spawn('auth', brief('TRIGGER_AUTH_REFUSAL'), {
    worktree: wt, model: MODEL, reasoningEffort: 'max',
  })).ok, true);
  const authLimit = Date.now() + 4000;
  while (!events.some((event) => event.kind === 'lifecycle.turn_completed') && Date.now() < authLimit) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const authResult = events.find((event) => event.kind === 'lifecycle.turn_completed')?.payload?.result;
  assert.equal(authResult?.status, 'failed');
  assert.deepEqual(authResult?.failure, { code: 'authentication_refresh_required' });
  assert.equal(authResult?.summary, 'Provider authentication requires refresh.');
  await auth.kill('auth');
});

test('KK3/KK5: protected provider output fails closed and never reaches content or result events', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-kimi-output-secret-'));
  for (const [worker, secret, marker] of [
    ['secret-output', 'fixture-only', 'REPORT_ENV:ANTHROPIC_AUTH_TOKEN'],
    ['secret-output-escaped', 'fixture-"quoted', 'REPORT_ENV:ANTHROPIC_AUTH_TOKEN'],
    ['secret-output-stderr', 'fixture-stderr', 'REPORT_SECRET_STDERR'],
  ]) {
    const cli = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: secret });
    const events = [];
    cli.onEvent((event) => events.push(event));
    assert.equal((await cli.spawn(worker, brief(marker), {
      worktree: wt, model: MODEL, reasoningEffort: 'max',
    })).ok, true);
    const limit = Date.now() + 4000;
    while (!events.some((event) => event.kind === 'lifecycle.crashed') && Date.now() < limit) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const crash = events.find((event) => event.kind === 'lifecycle.crashed');
    assert.equal(crash?.payload?.code, 'provider_output_secret');
    assert.equal(events.some((event) => JSON.stringify(event).includes(secret)), false);
    assert.equal(events.some((event) => event.kind === 'lifecycle.turn_completed'), false);
  }
});

test('KK5/PH2: structured success remains successful even when provider prose looks like an API error', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-kimi-prose-'));
  const cli = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' });
  const events = [];
  cli.onEvent((event) => events.push(event));
  assert.equal((await cli.spawn('prose', brief('API Error: Request rejected (429)'), {
    worktree: wt, model: MODEL, reasoningEffort: 'max',
  })).ok, true);
  const limit = Date.now() + 4000;
  while (!events.some((event) => event.kind === 'lifecycle.turn_completed') && Date.now() < limit) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const completed = events.find((event) => event.kind === 'lifecycle.turn_completed');
  assert.equal(completed?.payload?.result?.status, 'completed');
  assert.match(completed?.payload?.result?.summary ?? '', /API Error/);
  await cli.kill('prose');
});

test('KK4/KK5/KK7/KK8: coordinator derives isolation from the adapter card and kill preserves before cleanup without touching global Claude state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-kimi-integrated-'));
  const wt = join(root, 'worktree');
  mkdirSync(wt);
  const operatorHome = join(root, 'operator');
  const globalClaude = join(operatorHome, '.claude');
  mkdirSync(globalClaude, { recursive: true, mode: 0o700 });
  const globalSettings = join(globalClaude, 'settings.json');
  const original = '{"operator":"untouched"}\n';
  writeFileSync(globalSettings, original, { mode: 0o600 });
  const before = statSync(globalSettings);

  const isolation = new RuntimeIsolation({
    repoRoot: root,
    baseEnv: {
      PATH: process.env.PATH, HOME: operatorHome, CLAUDE_CONFIG_DIR: globalClaude,
      ANTHROPIC_API_KEY: 'ambient-must-not-cross', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'ambient',
    },
  });
  const selections = [];
  const runtimeScopes = {
    create(worker, selection) { selections.push(selection); return isolation.create(worker, selection); },
    remove(worker) { isolation.remove(worker); },
    reconcile(workers) { isolation.reconcile(workers); },
  };
  const progress = '2'.repeat(40);
  const checkpointRef = `refs/baton/checkpoints/${progress}`;
  const worktreeCalls = [];
  const worktrees = {
    async create(taskId) { worktreeCalls.push('create'); return { path: wt, branch: `baton/${taskId}`, baseSha: '1'.repeat(40) }; },
    async capture() { worktreeCalls.push('capture'); return { sha: progress, snapshotted: true, changedPaths: ['partial.txt'] }; },
    async retainCheckpoint() { worktreeCalls.push('retain'); return checkpointRef; },
    async resolveCheckpoint() { worktreeCalls.push('resolve'); return progress; },
    async remove() { worktreeCalls.push('remove'); },
    async reconcile() {},
  };
  const log = new Log(join(root, 'log'));
  const adapter = new KimiSessionCli({
    cmd: process.execPath, args: [FAKE], authToken: 'fixture-only', killGraceMs: 20,
  });
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { 'deliberately-not-a-provider-name': adapter }, runtimeScopes, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'deliberately-not-a-provider-name', approvalTimeoutMs: 100, stopDeadlineMs: 1000,
  });
  const handle = await coordinator.spawn('deliberately-not-a-provider-name', brief('HOLD_UNTIL_INTERRUPT'), {
    taskId: 'kimi-integrated-stop', model: MODEL, effort: 'max',
  });
  await until(() => log.read(handle.id).some((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'ready Kimi provider');
  assert.equal(selections.length, 1);
  assert.equal(selections[0].card.harness, 'claude-code');
  assert.equal(selections[0].card.modelSelection.family, 'kimi');
  assert.equal(coordinator._workers.get(handle.id).runtimeScope.family, 'kimi');
  assert.equal(coordinator._workers.get(handle.id).runtimeScope.authPosture, 'api_key');
  assert.deepEqual(coordinator._workers.get(handle.id).runtimeScope.credential, { mechanism: 'adapter', state: 'materialized', count: 1 });

  const stopped = await coordinator.kill(handle.id, 'operator:test');
  assert.deepEqual(stopped, { ok: true, result: 'confirmed', emulated: false });
  assert.deepEqual(worktreeCalls, ['create', 'capture', 'retain', 'resolve', 'remove']);
  assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_started'), true,
    log.read(handle.id).map((event) => event.kind).join(','));
  assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_closed'), true);
  assert.equal(log.read(handle.id).some((event) => event.kind === 'worktree.progress_checkpointed'), true);
  assert.equal(existsSync(join(isolation.root, handle.id)), false);
  assert.equal(readFileSync(globalSettings, 'utf8'), original);
  const after = statSync(globalSettings);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mode & 0o777, before.mode & 0o777);
  assert.equal(coordinator.closeAuthority(), true);
});
