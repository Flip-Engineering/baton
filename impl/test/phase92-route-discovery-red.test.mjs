// Phase 92 route-discovery fixtures prove static selection and sanitized readiness only. They are
// not live-provider login, refresh, model, or process-lifecycle proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const MODULE_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase92-route-discovery-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(home); mkdirSync(bin);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase92-routes@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 92 routes'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# route fixture\n');
  writeFileSync(join(repo, 'glm_key.json'), '{"glm_key":"fixture-not-live"}\n', { mode: 0o600 });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "Claude Code 9.8.7\\n"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf \'{"loggedIn":true}\\n\'; exit 0; fi',
    'exit 70',
    '',
  ].join('\n'));
  chmodSync(claude, 0o700);
  return { root, repo, home, bin };
}

test('P92-RD1: CLI-observed Claude login is ready without a credentials file and Kimi-through-Claude is explicitly unconfigured', () => {
  const { root, repo, home, bin } = fixture();
  try {
    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      ` deploymentRoot: ${JSON.stringify(join(root, 'deployment'))},`,
      ' verification: { command: process.execPath, arguments: ["--version"] },',
      '} });',
      'const profile = deployment.card().profiles[0];',
      'const readiness = await deployment.doctor();',
      'await deployment.close();',
      'process.stdout.write(JSON.stringify({ profile, readiness }));',
    ].join('\n');
    const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
    }));
    const claude = observed.readiness.routes.filter((route) => (
      route.harness === 'claude-code' && route.model === 'claude-opus-4-6'
    ));
    assert.equal(observed.profile.routes.some((route) => route.harness === 'claude-code'), true);
    assert.equal(claude.length, 5);
    assert.equal(claude.every((route) => route.state === 'ready'), true);
    const kimiViaClaude = observed.readiness.routes.find((route) => (
      route.harness === 'claude-code' && route.model === 'kimi-k3[1m]'
    ));
    assert.equal(kimiViaClaude?.state, 'blocked');
    assert.equal(kimiViaClaude?.code, 'route_unconfigured');
    assert.match(kimiViaClaude?.summary ?? '', /not configured/u);
    assert.equal(JSON.stringify(observed).includes(home), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
