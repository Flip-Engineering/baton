import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const MODULE_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;

function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'xdg-kimi@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'XDG Kimi fixture'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# XDG Kimi fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

test('XD1: Kimi-through-Claude discovery honors XDG_CONFIG_HOME without touching global Claude state', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-xdg-kimi-'));
  try {
    const repo = repository(root);
    const home = join(root, 'home');
    const xdg = join(root, 'xdg');
    const credential = join(xdg, 'baton', 'credentials', 'kimi.json');
    const claude = join(root, 'bin', 'claude');
    mkdirSync(dirname(credential), { recursive: true });
    mkdirSync(dirname(claude), { recursive: true });
    writeFileSync(credential, JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'fixture-kimi-key-must-never-be-public' },
    }), { mode: 0o600 });
    writeFileSync(claude, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  printf '9.8.7 (Claude Code fixture)\\n'",
      '  exit 0',
      'fi',
      'exit 70',
      '',
    ].join('\n'));
    chmodSync(claude, 0o700);

    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      `  deploymentRoot: ${JSON.stringify(join(root, 'deployment'))},`,
      '  verification: { command: process.execPath, arguments: ["--version"] },',
      '} });',
      'const doctor = await deployment.doctor();',
      'await deployment.close();',
      'process.stdout.write(JSON.stringify(doctor));',
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: xdg,
        PATH: `${dirname(claude)}:${process.env.PATH ?? ''}`,
      },
    });
    const doctor = JSON.parse(output);

    assert.equal(doctor.ready, true);
    assert.equal(doctor.routes.length, 1);
    assert.deepEqual(
      { harness: doctor.routes[0].harness, model: doctor.routes[0].model, effort: doctor.routes[0].effort },
      { harness: 'claude-code', model: 'kimi-k3[1m]', effort: 'max' },
    );
    assert.equal(doctor.routes[0].state, 'ready');
    assert.equal(doctor.routes[0].runtime.authentication.state, 'available');
    const publicOutput = JSON.stringify(doctor);
    assert.equal(publicOutput.includes('fixture-kimi-key'), false);
    assert.equal(publicOutput.includes(xdg), false);
    assert.equal(publicOutput.includes(home), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('XD2: relative XDG_CONFIG_HOME refuses instead of silently changing credential authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-relative-xdg-'));
  try {
    const repo = repository(root);
    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      'let observed;',
      `try { await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      `  deploymentRoot: ${JSON.stringify(join(root, 'deployment'))},`,
      '  verification: { command: process.execPath, arguments: ["--version"] },',
      '} }); } catch (error) { observed = { code: error?.code, message: error?.message }; }',
      'process.stdout.write(JSON.stringify(observed));',
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: 'relative-config' },
    });
    const observed = JSON.parse(output);
    assert.equal(observed.code, 'deployment_config_invalid');
    assert.match(observed.message, /XDG_CONFIG_HOME must be an absolute path/u);
    assert.equal(observed.message.includes(root), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
