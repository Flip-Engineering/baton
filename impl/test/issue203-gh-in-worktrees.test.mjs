// Issue #203 — a member worktree's own `gh` is unauthenticated. A seat runs under a private
// runtime HOME (RuntimeIsolation), and gh keeps its token in the login keyring, which macOS
// resolves under the REAL $HOME — so the private HOME reaches no keychain item and gh reports no
// logged-in host. The deployment reads the operator's token at the root and projects a file-backed
// `hosts.yml` into every seat's private HOME, which is where gh looks first. These rows hold the
// projection (document shape, HOME-relative placement, modes, absence) and, when the host itself
// has an authenticated gh, the end-to-end read in a seat-shaped environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { ghCredentialDocument, operatorGhToken } from '../src/application-deployment.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

function makeIsolation(tag, extra = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), `baton-203-${tag}-`));
  return new RuntimeIsolation({
    repoRoot,
    baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent-operator-home', LANG: 'C' },
    ...extra,
  });
}

const hostsPath = (scope) => join(scope.paths.home, '.config', 'gh', 'hosts.yml');

function ghAuthStatus(scope) {
  try {
    return { status: 0, output: execFileSync('gh', ['auth', 'status'],
      { env: scope.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('issue203 (a): no operator token yields no document, and a token yields the HOME-relative hosts.yml', () => {
  assert.equal(ghCredentialDocument({ token: null }), null);
  assert.equal(ghCredentialDocument({ token: '' }), null);
  const document = ghCredentialDocument({ token: 'gho_canary_token_value' });
  assert.ok(document && typeof document.read === 'function', 'a token yields a readable document');
  const read = document.read();
  assert.equal(read.relativePath, '.config/gh/hosts.yml',
    'gh resolves $HOME/.config/gh/hosts.yml, so the document lands at that HOME-relative path');
  assert.match(read.content, /^github\.com:\n {4}oauth_token: gho_canary_token_value\n/u);
});

test("issue203 (b): the root token read trims gh's answer and answers null when gh cannot", async () => {
  assert.equal(await operatorGhToken({ read: async () => '  gho_trimmed\n' }), 'gho_trimmed');
  assert.equal(await operatorGhToken({ read: async () => '   \n' }), null);
  assert.equal(await operatorGhToken({ read: async () => { throw new Error('gh absent'); } }), null);
});

test("issue203 (c): a lease's private HOME carries the projected gh credential, owner-only", () => {
  const isolation = makeIsolation('c', { ghCredential: ghCredentialDocument({ token: 'gho_seat_token' }) });
  const scope = isolation.create('seat-203-c', 'codex');
  assert.equal(existsSync(hostsPath(scope)), true, 'the seat HOME carries hosts.yml');
  assert.equal(lstatSync(join(scope.paths.home, '.config', 'gh')).mode & 0o777, 0o700);
  assert.equal(lstatSync(hostsPath(scope)).mode & 0o777, 0o600);
  assert.match(readFileSync(hostsPath(scope), 'utf8'), /oauth_token: gho_seat_token/u);
  isolation.remove('seat-203-c');
});

test('issue203 (d): without an operator token the seat HOME projects no gh document at all', () => {
  const isolation = makeIsolation('d');
  const scope = isolation.create('seat-203-d', 'codex');
  assert.equal(existsSync(hostsPath(scope)), false, 'an authenticated operator is the only source');
  assert.equal(existsSync(join(scope.paths.home, '.config', 'gh')), false);
  isolation.remove('seat-203-d');
});

// The end-to-end row runs the real gh against a lease-shaped environment; it needs gh installed AND
// an authenticated operator, and reports the missing prerequisite instead of failing.
const operatorToken = await operatorGhToken();
const ghReady = (() => {
  if (operatorToken === null) return false;
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
})();
const needsOperatorGh = { skip: ghReady ? false : 'gh is absent or the operator is not logged in' };

test('issue203 (e): gh in a seat-shaped environment reads the projected credential', needsOperatorGh, (t) => {
  const isolation = makeIsolation('e', { ghCredential: ghCredentialDocument({ token: operatorToken }) });
  const scope = isolation.create('seat-203-e', 'codex');
  t.after(() => { isolation.remove('seat-203-e'); });
  const result = ghAuthStatus(scope);
  assert.equal(result.status, 0, 'the seat HOME alone authenticates gh');
  assert.match(result.output, /Logged in to github\.com/u);

  // The same seat without the projection is the defect #203 records.
  const bare = makeIsolation('e-bare');
  const bareScope = bare.create('seat-203-e-bare', 'codex');
  t.after(() => { bare.remove('seat-203-e-bare'); });
  const bareResult = ghAuthStatus(bareScope);
  assert.notEqual(bareResult.status, 0, 'a seat HOME with no projection is unauthenticated');
  assert.match(bareResult.output, /not logged into any GitHub hosts|gh auth login/u);
});
