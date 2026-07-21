import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { parseBatonCli } from '../src/application-cli.mjs';
import { loadProviderCredentialFile } from '../src/claude-session.mjs';
import {
  formatKimiCredentialInstallResult, installKimiCredential, kimiCredentialPath,
  KIMI_CREDENTIAL_HELP, readHiddenKimiCredential,
} from '../src/kimi-credential-setup.mjs';

const SECRET_A = 'sk-kimi-distinctive-secret-a';
const SECRET_B = 'sk-kimi-distinctive-secret-b';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-kimi-credential-'));
  const home = join(root, 'home');
  const config = join(root, 'xdg');
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(config, { mode: 0o755 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, config, env: { HOME: home, XDG_CONFIG_HOME: config } };
}

test('KK3 setup: the unified CLI surface is exact, discoverable, and accepts no key argument', () => {
  assert.deepEqual(parseBatonCli(['credentials']), { kind: 'credential-help' });
  assert.deepEqual(parseBatonCli(['credentials', '--help']), { kind: 'credential-help' });
  assert.deepEqual(parseBatonCli(['credentials', 'install', 'kimi', '--help']), { kind: 'credential-help' });
  assert.deepEqual(parseBatonCli(['help', 'credentials']), { kind: 'credential-help' });
  assert.deepEqual(parseBatonCli(['credentials', 'install', 'kimi']), {
    kind: 'credential-install', provider: 'kimi',
  });
  assert.match(KIMI_CREDENTIAL_HELP, /baton credentials install kimi/u);
  assert.match(KIMI_CREDENTIAL_HELP, /never accepted on argv/u);
  assert.throws(() => parseBatonCli(['credentials', 'install', 'kimi', SECRET_A]), /unexpected argument/u);
  const applicationHelp = spawnSync(process.execPath, ['scripts/baton.mjs', '--help'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {},
  });
  assert.equal(applicationHelp.status, 0);
  assert.match(applicationHelp.stdout, /baton credentials install kimi/u);
});

test('KK3 setup: install honors XDG, publishes the loader shape at 0600, and hardens Baton parents to 0700', (t) => {
  const f = fixture(t);
  const previousUmask = process.umask();
  const result = installKimiCredential({ token: SECRET_A, env: f.env, home: f.home });
  const expected = join(f.config, 'baton', 'credentials', 'kimi.json');
  assert.equal(result.installedPath, expected);
  assert.equal(result.credentialPresence, 'present');
  assert.equal(kimiCredentialPath({ env: f.env, home: f.home }), expected);
  assert.equal(statSync(join(f.config, 'baton')).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.config, 'baton', 'credentials')).mode & 0o777, 0o700);
  assert.equal(statSync(expected).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(expected, 'utf8')), {
    env: { ANTHROPIC_AUTH_TOKEN: SECRET_A },
  });
  assert.equal(loadProviderCredentialFile(expected, { providerLabel: 'Kimi' }), SECRET_A);
  assert.equal(process.umask(), previousUmask, 'the caller process umask is restored');
});

test('KK3 setup: the fallback path is HOME/.config and native Kimi/global Claude state is untouched', (t) => {
  const f = fixture(t);
  const env = { HOME: f.home };
  const native = join(f.home, '.kimi-code', 'credentials');
  const claude = join(f.home, '.claude');
  mkdirSync(native, { recursive: true, mode: 0o700 });
  mkdirSync(claude, { mode: 0o700 });
  writeFileSync(join(native, 'kimi-code.json'), 'native-subscription-sentinel\n', { mode: 0o600 });
  writeFileSync(join(claude, '.credentials.json'), 'claude-login-sentinel\n', { mode: 0o600 });
  const result = installKimiCredential({ token: SECRET_A, env, home: f.home });
  assert.equal(result.installedPath, join(f.home, '.config', 'baton', 'credentials', 'kimi.json'));
  assert.equal(readFileSync(join(native, 'kimi-code.json'), 'utf8'), 'native-subscription-sentinel\n');
  assert.equal(readFileSync(join(claude, '.credentials.json'), 'utf8'), 'claude-login-sentinel\n');
});

test('KK3 setup: replacement is same-directory and atomic, with no temporary residue', (t) => {
  const f = fixture(t);
  const first = installKimiCredential({ token: SECRET_A, env: f.env, home: f.home });
  let observed = null;
  const second = installKimiCredential({
    token: SECRET_B, env: f.env, home: f.home,
    advanced: { rename(source, target) {
      observed = { source, target };
      assert.equal(dirname(source), dirname(target));
      assert.equal(readFileSync(target, 'utf8').includes(SECRET_A), true, 'old value remains until rename');
      renameSync(source, target);
    } },
  });
  assert.equal(second.installedPath, first.installedPath);
  assert.equal(loadProviderCredentialFile(first.installedPath, { providerLabel: 'Kimi' }), SECRET_B);
  assert.equal(observed.target, first.installedPath);
  assert.deepEqual(readdirSync(dirname(first.installedPath)), ['kimi.json']);
});

test('KK3 setup: publish failure preserves the old credential and removes the same-directory temporary', (t) => {
  const f = fixture(t);
  const first = installKimiCredential({ token: SECRET_A, env: f.env, home: f.home });
  assert.throws(() => installKimiCredential({
    token: SECRET_B, env: f.env, home: f.home,
    advanced: { rename() { throw new Error('simulated rename refusal'); } },
  }), (error) => error.code === 'install_failed'
    && !error.message.includes(SECRET_A) && !error.message.includes(SECRET_B));
  assert.equal(loadProviderCredentialFile(first.installedPath, { providerLabel: 'Kimi' }), SECRET_A);
  assert.deepEqual(readdirSync(dirname(first.installedPath)), ['kimi.json']);
});

test('KK3 setup: result output contains only the installed path and presence, never the key', (t) => {
  const f = fixture(t);
  const result = installKimiCredential({ token: SECRET_A, env: f.env, home: f.home });
  const output = formatKimiCredentialInstallResult(result);
  assert.equal(output, `installed: ${result.installedPath}\ncredential-presence: present`);
  assert.equal(output.includes(SECRET_A), false);
  assert.equal(JSON.stringify(result).includes(SECRET_A), false);
});

class FakeTtyInput extends EventEmitter {
  constructor() { super(); this.isTTY = true; this.isRaw = false; this.rawTransitions = []; this.paused = true; }
  setRawMode(value) { this.isRaw = value; this.rawTransitions.push(value); }
  isPaused() { return this.paused; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
}

test('KK3 setup: TTY input is raw and hidden, supports correction, and restores terminal state', async () => {
  const input = new FakeTtyInput();
  const chunks = [];
  const output = { isTTY: true, write(value) { chunks.push(String(value)); } };
  const reading = readHiddenKimiCredential({ input, output });
  input.emit('data', Buffer.from('sk-abcX\u007fD\r'));
  assert.equal(await reading, 'sk-abcD');
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.paused, true);
  assert.equal(chunks.join(''), 'Kimi API key: \n');
  assert.equal(chunks.join('').includes('sk-abcD'), false);
});

test('KK3 setup: terminal signals cancel hidden input and restore raw mode without key output', async () => {
  const input = new FakeTtyInput();
  const signals = new EventEmitter();
  const chunks = [];
  const output = { isTTY: true, write(value) { chunks.push(String(value)); } };
  const reading = readHiddenKimiCredential({ input, output, signals });
  input.emit('data', Buffer.from('part-of-a-private-key'));
  signals.emit('SIGTERM');
  await assert.rejects(() => reading, (error) => error.code === 'input_cancelled');
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.paused, true);
  assert.equal(chunks.join('').includes('part-of-a-private-key'), false);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('KK3 setup: redirected stdin refuses without reading or creating a credential', async (t) => {
  const f = fixture(t);
  await assert.rejects(() => readHiddenKimiCredential({
    input: { isTTY: false }, output: { isTTY: true, write() {} },
  }), (error) => error.code === 'tty_required');
  const child = spawnSync(process.execPath, ['scripts/baton.mjs', 'credentials', 'install', 'kimi'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', input: `${SECRET_A}\n`,
    env: { HOME: f.home, XDG_CONFIG_HOME: f.config, PATH: process.env.PATH },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /tty_required/u);
  assert.equal(`${child.stdout}${child.stderr}`.includes(SECRET_A), false);
  assert.equal(existsSync(join(f.config, 'baton', 'credentials', 'kimi.json')), false);
});

test('KK3 setup: unsafe existing targets and symlinked Baton parents refuse without token disclosure', (t) => {
  const f = fixture(t);
  const baton = join(f.config, 'baton');
  const elsewhere = join(f.root, 'elsewhere');
  mkdirSync(elsewhere, { mode: 0o700 });
  // A regular permissive Baton parent is hardened in place.
  mkdirSync(baton, { mode: 0o777 }); chmodSync(baton, 0o777);
  installKimiCredential({ token: SECRET_A, env: f.env, home: f.home });
  assert.equal(statSync(baton).mode & 0o777, 0o700);
  rmSync(baton, { recursive: true, force: true });
  symlinkSync(elsewhere, baton, 'dir');
  assert.throws(() => installKimiCredential({ token: SECRET_B, env: f.env, home: f.home }), (error) => (
    error.code === 'credential_directory_unsafe' && !error.message.includes(SECRET_B)
  ));
});
