import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KimiSessionCli, loadProviderCredentialFile } from '../src/claude-session.mjs';

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

test('KK1: card exposes exact K3 model and max-only required effort with no xhigh alias', () => {
  const card = new KimiSessionCli({ cmd: process.execPath, args: [FAKE], authToken: 'fixture-only' }).card();
  assert.equal(card.harness, 'claude-code');
  assert.equal(card.modelSelection.family, 'kimi');
  assert.deepEqual(card.modelSelection.available, [MODEL]);
  assert.deepEqual(card.modelSelection.reasoningEffort, ['max']);
  assert.equal(card.modelSelection.effortRequired, true);
  assert.deepEqual(card.modelSelection.acceptedAliases, []);
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
      const worker = `k-${n++}`;
      const ack = await cli.spawn(worker, brief(`REPORT_ENV:${name}`), {
        worktree: wt, model: MODEL, reasoningEffort: 'max',
        env: { ANTHROPIC_API_KEY: 'ambient-must-disappear', MOONSHOT_API_KEY: 'ambient-must-disappear', [name]: 'conflict' },
      });
      assert.equal(ack.ok, true, ack.reason);
      assert.ok((await wait(worker)).includes(`env:${name}=${value}`));
      await cli.kill(worker);
    }
    const argvWorker = 'k-argv';
    assert.equal((await cli.spawn(argvWorker, brief('REPORT_ARGV'), { worktree: wt, model: MODEL, reasoningEffort: 'max' })).ok, true);
    const summary = await wait(argvWorker);
    assert.ok(summary.includes(`--model","${MODEL}`));
    assert.ok(summary.includes('--effort","max'));
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
  assert.equal(mismatchEvents.some((event) => event.kind === 'lifecycle.spawned'), false);
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
  assert.equal(events.find((event) => event.kind === 'lifecycle.turn_completed')?.payload?.result?.status, 'failed');
  await auth.kill('auth');
});
