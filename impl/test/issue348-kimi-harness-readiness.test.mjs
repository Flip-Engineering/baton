// Issue #348 — kimi-code route readiness checks the HARNESS before the credential.
//
// OBSERVED (2026-09-17, doctor over the MCP bridge on the clone resident): on a host with NO
// `kimi` binary and a credential that expired 34 days earlier, the kimi-code row read
//   {"harness":"kimi-code","model":"kimi-code/k3","effort":"high","state":"blocked",
//    "code":"authentication_refresh_required"}
// with the summary "Run the ordinary `kimi` login flow" — a login the host cannot run, because
// there is no binary. The grok row on the same table answered `harness_unavailable` for exactly
// this situation; the kimi row never looked at the harness at all.
//
// The law this file pins (#348):
//   (a) the HARNESS is checked before the credential: no executable under the paths the command
//       resolution probes blocks `harness_unavailable`, names those paths, and offers the install
//       step; no credential verdict is published for a harness this host cannot run;
//   (b) a PRESENT harness with an expired credential keeps `authentication_refresh_required` and
//       its remedy now carries the facts the host shows — the expiry instant and whether a
//       refresh token sits beside it;
//   (c) a present harness with a fresh credential stays ready.
//
// Fixture: the real deployment (`openBaton`) in a child process with `HOME` pointed at a temp
// home, exactly as impl/test/phase78-native-kimi-auth-readiness.test.mjs stands one up.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const MODULE_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;
const ROUTE = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });

function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue348@example.invalid', GIT_COMMITTER_EMAIL: 'issue348@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 348 fixture', GIT_COMMITTER_NAME: 'Issue 348 fixture' });
  writeFileSync(join(repo, 'README.md'), '# issue 348 kimi harness fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function credential(expiresAt, { refreshToken = true } = {}) {
  return `${JSON.stringify({
    access_token: 'fixture-access-token-must-never-be-public',
    refresh_token: refreshToken ? 'fixture-refresh-token-must-never-be-public' : '',
    expires_at: expiresAt,
    expires_in: 900,
    scope: 'fixture',
    token_type: 'Bearer',
  })}\n`;
}

/** `<root>/home` with the credential tree always present; the harness executable only when
 * `binary` is true, so the two rulings differ by one fact and nothing else. */
function kimiHome(root, { binary, credentialWire }) {
  const home = join(root, 'home');
  const kimi = join(home, '.kimi-code');
  for (const relative of ['bin/kimi', 'credentials/kimi-code.json', 'oauth/kimi-code']) {
    mkdirSync(dirname(join(kimi, relative)), { recursive: true });
  }
  writeFileSync(join(kimi, 'config.toml'), '[auth]\nmethod = "oauth"\n');
  writeFileSync(join(kimi, 'device_id'), 'issue348-device\n', { mode: 0o600 });
  writeFileSync(join(kimi, 'oauth', 'kimi-code'), '');
  writeFileSync(join(kimi, 'credentials', 'kimi-code.json'), credentialWire, { mode: 0o600 });
  if (binary) {
    writeFileSync(join(kimi, 'bin', 'kimi'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  printf 'Kimi Code v9.8.7\\n'",
      '  exit 0',
      'fi',
      'exit 70',
      '',
    ].join('\n'));
    chmodSync(join(kimi, 'bin', 'kimi'), 0o700);
  }
  return home;
}

function inspectDeployment({ binary, credentialWire, attemptRun = false }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue348-'));
  try {
    const repo = repository(root);
    const home = kimiHome(root, { binary, credentialWire });
    // A PATH carrying a real git and no `kimi` anywhere on it, so the probe's second question is
    // answered by the fixture and never by whatever this host happens to have installed. The
    // deployment resolves git through PATH itself, so the fixture provides one.
    const emptyPath = join(root, 'bin');
    mkdirSync(emptyPath);
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(),
      join(emptyPath, 'git'));
    const deploymentRoot = join(root, 'deployment');
    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      `const route = ${JSON.stringify(ROUTE)};`,
      `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      `  deploymentRoot: ${JSON.stringify(deploymentRoot)},`,
      '  verification: { command: process.execPath, arguments: ["--version"] },',
      '} });',
      'let runError = null;',
      attemptRun
        ? 'try { await deployment.run("must be refused before provider spawn", { exact: route }); } catch (error) { runError = { code: error?.code, message: error?.message }; }'
        : '',
      'const doctor = await deployment.doctor();',
      'await deployment.close();',
      'process.stdout.write(JSON.stringify({ doctor, runError }));',
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: emptyPath },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
    return { observed: JSON.parse(output), home };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const kimiRoute = (observed) => observed.doctor.routes.find((row) => row.harness === 'kimi-code');

test('348-a: a host with no kimi executable reports harness_unavailable naming the probed paths, before any credential verdict', () => {
  const expiredAt = Math.floor(Date.now() / 1000) - (34 * 24 * 60 * 60);
  const { observed, home } = inspectDeployment({
    binary: false,
    credentialWire: credential(expiredAt),
    attemptRun: true,
  });
  const route = kimiRoute(observed);

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'harness_unavailable',
    'the harness fact is the one a host with no executable must hear first');
  assert.match(route?.summary ?? '', /~\/\.kimi-code\/bin\/kimi/u, 'the summary names the preferred path it probed');
  assert.match(route?.summary ?? '', /kimi on PATH/u, 'the summary names the PATH lookup it probed');
  assert.match(route?.summary ?? '', /Install the Kimi Code CLI/u, 'the remedy is executable on this host');
  assert.notEqual(route?.runtime?.authentication?.state, 'expired',
    'no credential verdict is published for a harness this host cannot run');
  assert.equal(observed.runError?.code, 'harness_unavailable',
    'a run on the route is refused with the same harness truth');
  assert.equal(JSON.stringify(observed).includes(home), false,
    'the readiness rows never publish this host\'s absolute credential paths');
});

test('348-b: a present kimi executable with an expired credential keeps the refresh verdict and names the expiry and the refresh token', () => {
  const expiredAt = Math.floor(Date.now() / 1000) - 60;
  const { observed } = inspectDeployment({
    binary: true,
    credentialWire: credential(expiredAt),
    attemptRun: true,
  });
  const route = kimiRoute(observed);

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_refresh_required');
  assert.equal(route?.runtime?.authentication?.state, 'expired');
  assert.match(route?.summary ?? '', /ordinary `kimi` login flow/u, 'the login remedy is kept');
  assert.match(route?.summary ?? '', new RegExp(new Date(expiredAt * 1000).toISOString().replace(/\./gu, '\\.'), 'u'),
    'the row states when the stored access token expired');
  assert.match(route?.summary ?? '', /A refresh token is present/u,
    'the row states whether a refresh token sits beside it');
  assert.equal(observed.runError?.code, 'authentication_refresh_required');
  assert.equal(JSON.stringify(observed).includes('fixture-access-token'), false);
  assert.equal(JSON.stringify(observed).includes('fixture-refresh-token'), false);
});

test('348-b2: the same row says so when no refresh token is present', () => {
  const expiredAt = Math.floor(Date.now() / 1000) - 60;
  const { observed } = inspectDeployment({
    binary: true,
    credentialWire: credential(expiredAt, { refreshToken: false }),
  });
  const route = kimiRoute(observed);

  assert.equal(route?.code, 'authentication_refresh_required');
  assert.match(route?.summary ?? '', /No refresh token is present/u);
});

test('348-c: a present kimi executable with a fresh credential stays ready', () => {
  const freshAt = Math.floor(Date.now() / 1000) + 3600;
  const { observed } = inspectDeployment({
    binary: true,
    credentialWire: credential(freshAt),
  });
  const route = kimiRoute(observed);

  assert.equal(route?.state, 'ready', `the route is ready, observed ${JSON.stringify(route)}`);
  assert.equal(route?.runtime?.authentication?.state, 'available');
});
